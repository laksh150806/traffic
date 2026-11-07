import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { LogOut, RefreshCw, ShieldCheck, Volume2, VolumeX } from "lucide-react";

import { BeamButton } from "@/components/fx/controls";
import {
  ClickSpark,
  ConsoleGreeting,
  FilmOverlay,
  PixelWipe,
  TabPresence,
  TargetCursor,
  Ticker,
  Toaster,
  toast,
} from "@/components/fx/global";
import { CircularText, Decrypt, HyperText, MorphText } from "@/components/fx/text";
import { Serial } from "@/components/fx/decor";
import { AUTH_AVAILABLE, signOut, useAuth } from "@/lib/auth";
import { DATA_MODE } from "@/lib/data-mode";
import { describeAction, fetchOperatorLog } from "@/lib/ops-data";
import { fetchJunctions } from "@/lib/traffic-data";
import { useEngine } from "./engine";
import { installUiSounds, isMuted, onMuteChange, setMuted, sfx } from "@/components/fx/sound";

const NAV = [
  { to: "/", label: "Control room" },
  { to: "/junctions", label: "Junctions" },
  { to: "/incidents", label: "Incidents" },
] as const;

function istTime(d: Date) {
  return d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Brand mark: a junction seen from above, its four approaches and a turning sweep. */
function Mark() {
  return (
    <svg viewBox="0 0 32 32" className="ops-mark" aria-hidden>
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeOpacity="0.35" />
      <path d="M16 2v9M16 21v9M2 16h9M21 16h9" stroke="currentColor" strokeWidth="2" />
      <rect
        x="12"
        y="12"
        width="8"
        height="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <g className="fx-spin-med" style={{ transformOrigin: "16px 16px" }}>
        <path d="M16 16 L16 3 A13 13 0 0 1 27 9 Z" fill="currentColor" fillOpacity="0.25" />
      </g>
    </svg>
  );
}

function Nav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const wrap = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const active = wrap.current?.querySelector<HTMLAnchorElement>("a[data-status='active']");
    if (!active) return setPill(null);
    setPill({ left: active.offsetLeft, width: active.offsetWidth });
  }, [path]);
  return (
    <nav ref={wrap} className="ops-nav" aria-label="Sections">
      {pill ? (
        <span aria-hidden className="ops-nav-pill" style={{ left: pill.left, width: pill.width }} />
      ) : null}
      {NAV.map((item) => (
        <Link key={item.to} to={item.to} activeOptions={{ exact: item.to === "/" }}>
          <HyperText text={item.label} />
        </Link>
      ))}
    </nav>
  );
}

function RoleBadge() {
  const auth = useAuth();
  if (!AUTH_AVAILABLE) return <span className="ops-role role-viewer hide-sm">SIM · OPEN</span>;
  if (auth.status === "loading") return <span className="ops-role role-viewer">···</span>;
  if (auth.status === "signed-out")
    return (
      <Link to="/login" className="ops-btn">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Sign in
      </Link>
    );
  const role = auth.status === "signed-in" ? auth.operator.role : "viewer";
  const name = auth.status === "signed-in" ? auth.operator.displayName : (auth.email ?? "operator");
  return (
    <>
      <span className={`ops-role role-${role}`} title={name}>
        {role}
      </span>
      <button
        type="button"
        className="ops-btn"
        aria-label={`Sign out ${name}`}
        onClick={() => {
          void signOut().then(() => toast("Signed out. Console is read-only.", "info"));
        }}
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden />
      </button>
    </>
  );
}

/** Sound on/off. Starts as "on" on the server and syncs to the saved choice after hydration. */
function SoundToggle() {
  const [muted, setM] = useState(false);
  useEffect(() => {
    setM(isMuted());
    return onMuteChange(setM);
  }, []);
  return (
    <button
      type="button"
      className="ops-btn"
      aria-pressed={!muted}
      title={muted ? "Sound off" : "Sound on"}
      onClick={() => setMuted(!muted)}
    >
      {muted ? (
        <VolumeX className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Volume2 className="h-3.5 w-3.5" aria-hidden />
      )}
      <span className="sr-only">{muted ? "Turn sound on" : "Turn sound off"}</span>
    </button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => installUiSounds(), []);
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    sfx.nav();
  }, [path]);
  const engine = useEngine();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const junctions = useQuery({
    queryKey: ["junctions"],
    queryFn: fetchJunctions,
    refetchInterval: 6000,
  });
  const jammed = (junctions.data ?? []).filter((j) => j.congestion_level === "HIGH").length;
  const auth = useAuth();
  const log = useQuery({
    queryKey: ["operator-log", 20],
    queryFn: () => fetchOperatorLog(20),
    enabled: AUTH_AVAILABLE && auth.status === "signed-in",
    refetchInterval: 10_000,
    retry: false,
  });

  const state = engine.busy
    ? "SOLVING"
    : junctions.isError
      ? "LINK LOST"
      : jammed > 0
        ? `${jammed} JAMMED`
        : "NOMINAL";

  const tickerItems =
    log.data && log.data.length > 0
      ? log.data.map((e) => describeAction(e))
      : [
          "Queue model re-solves every 12 s",
          "Signal controller ends and reassigns green every 2 s",
          `${junctions.data?.length ?? 69} junctions on the board`,
          "Queues are modelled, not measured",
          "No signal hardware is driven from this console",
          DATA_MODE === "live" ? "Data: Supabase live" : "Data: in-browser simulation",
        ];

  const isLogin = path === "/login";

  return (
    <div className="ops-shell ops-body">
      <FilmOverlay />
      <TargetCursor />
      <ClickSpark />
      <TabPresence jammed={jammed} />
      <ConsoleGreeting />
      <PixelWipe trigger={path} />
      <Toaster />

      {isLogin ? null : (
        <header className="ops-top">
          <Link to="/" className="ops-brand" aria-label="Signal Ops home">
            <Mark />
            <span>
              <Decrypt text="SIGNAL OPS" />
              <small className="block">CHENNAI · ADAPTIVE CONTROL</small>
            </span>
          </Link>
          <Nav />
          <div className="ops-right">
            <span className="ops-state hide-sm">
              <MorphText text={state} />
            </span>
            <span className="ops-clock hide-sm" title="India Standard Time">
              <CircularText text="IST · SIGNAL OPS · LIVE CLOCK · " size={48} />
              <b>{now ? istTime(now) : "--:--"}</b>
            </span>
            <BeamButton
              active={engine.busy}
              disabled={engine.busy}
              onClick={() => {
                void engine.recalculate().then(() => toast("Network re-solved.", "ok"));
              }}
              title="Run the queue model now instead of waiting for the 12 s loop"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${engine.busy ? "animate-spin" : ""}`}
                aria-hidden
              />
              <span className="hide-sm">Re-solve</span>
            </BeamButton>
            <SoundToggle />
            <RoleBadge />
          </div>
        </header>
      )}

      <div className="ops-main">{children}</div>

      {isLogin ? null : (
        <footer className="ops-bottom">
          <span>{log.data?.length ? "OPS LOG" : "SYS"}</span>
          <Ticker items={tickerItems} label="Recent operator actions" />
          <span className="hide-sm">
            <Serial code={`SO-${(engine.switches % 10000).toString().padStart(4, "0")}`} />
          </span>
        </footer>
      )}
    </div>
  );
}

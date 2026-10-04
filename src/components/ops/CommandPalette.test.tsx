// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette, type PaletteAction } from "@/components/ops/CommandPalette";
import type { JunctionSummary } from "@/lib/traffic-types";
import { stubBrowser } from "@/test-utils/dom";

stubBrowser();
afterEach(cleanup);

const junction = (id: number, name: string, zone = "Central"): JunctionSummary => ({
  junction_id: id,
  name,
  zone,
  latitude: 13,
  longitude: 80.2,
  avg_vehicle_count: 0,
  total_vehicle_count: 0,
  congestion_level: "LOW",
  last_reading_at: null,
});

const setup = () => {
  const junctions = [
    junction(1, "Tambaram Junction", "GST Corridor"),
    junction(2, "Kathipara Junction"),
    junction(3, "Guindy Signal"),
  ];
  const run = vi.fn();
  const actions: PaletteAction[] = [
    { id: "tour", label: "Take the guided tour", keywords: "present", run },
    { id: "now", label: "Back to now", run: vi.fn() },
  ];
  const onPickJunction = vi.fn();
  render(
    <CommandPalette junctions={junctions} actions={actions} onPickJunction={onPickJunction} />,
  );
  return { run, onPickJunction, actions };
};

const open = async () => {
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  return screen.findByRole("combobox");
};

describe("CommandPalette", () => {
  it("is closed until Ctrl+K, then takes focus", async () => {
    setup();
    expect(screen.queryByRole("dialog")).toBeNull();
    const input = await open();
    expect(screen.getByRole("dialog")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("opens with Cmd+K and with / outside a text field, and not with / inside one", async () => {
    render(
      <>
        <input aria-label="elsewhere" />
        <CommandPalette junctions={[]} actions={[]} onPickJunction={() => {}} />
      </>,
    );
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.keyDown(screen.getByLabelText("elsewhere"), { key: "/" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("lists the actions first, then narrows to junctions and actions as you type", async () => {
    setup();
    await open();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringContaining("Take the guided tour"),
      expect.stringContaining("Back to now"),
    ]);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "kath" } });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]!.textContent).toContain("Kathipara Junction");
  });

  it("matches an action on its keywords as well as its label", async () => {
    setup();
    await open();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "present" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option").textContent).toContain("Take the guided tour");
  });

  it("runs the highlighted action on Enter and closes", async () => {
    const { run } = setup();
    const input = await open();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(run).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("moves with the arrow keys, wraps round, and reports the active option", async () => {
    const { actions } = setup();
    const input = await open();
    const [first, second] = screen.getAllByRole("option");
    expect(input.getAttribute("aria-activedescendant")).toBe(first!.id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(second!.id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(first!.id);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(second!.id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(actions[1]!.run).toHaveBeenCalled();
  });

  it("selects a junction when one is chosen", async () => {
    const { onPickJunction } = setup();
    const input = await open();
    fireEvent.change(input, { target: { value: "guindy" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPickJunction).toHaveBeenCalledWith(expect.objectContaining({ junction_id: 3 }));
  });

  it("says when nothing matches, and Enter then does nothing", async () => {
    const { run, onPickJunction } = setup();
    const input = await open();
    fireEvent.change(input, { target: { value: "zzzz" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(run).not.toHaveBeenCalled();
    expect(onPickJunction).not.toHaveBeenCalled();
  });

  it("closes on Escape and when the backdrop is clicked, and gives focus back", async () => {
    render(
      <>
        <button>before</button>
        <CommandPalette junctions={[]} actions={[]} onPickJunction={() => {}} />
      </>,
    );
    const button = screen.getByText("before");
    button.focus();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await screen.findByRole("dialog");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(button);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dialog = await screen.findByRole("dialog");
    fireEvent.mouseDown(dialog.parentElement!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps Tab inside the box while it is open", async () => {
    setup();
    const input = await open();
    const notPrevented = fireEvent.keyDown(input, { key: "Tab" });
    expect(notPrevented).toBe(false);
    act(() => {});
  });
});

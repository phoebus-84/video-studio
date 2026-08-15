<script lang="ts">
  /**
   * The edge between two panels: drag to resize, click to collapse.
   *
   * One control rather than two, because a 14px strip cannot hold a drag
   * target and a button without them fighting. A press that moves is a resize;
   * a press that does not is a toggle. Keyboard users get the same two things
   * from arrow keys and Enter, which is why this is a real `separator` with a
   * reported value rather than a styled div.
   */
  interface Props {
    /** Current width of the panel this divider controls. */
    width: number;
    min: number;
    max: number;
    /** Whether the panel is currently open. */
    open: boolean;
    /** Which side the panel is on; decides which way dragging grows it. */
    side: "left" | "right";
    label: string;
    onresize: (width: number) => void;
    ontoggle: () => void;
  }

  let { width, min, max, open, side, label, onresize, ontoggle }: Props = $props();

  /** Movement under this many pixels is a click, not a drag. */
  const DRAG_THRESHOLD = 3;
  /** How far one arrow key press moves the edge. */
  const STEP = 16;

  let dragging = $state(false);

  function clamp(value: number): number {
    return Math.min(max, Math.max(min, value));
  }

  function onpointerdown(event: PointerEvent) {
    // Only the primary button starts a drag; let the browser keep the rest.
    if (event.button !== 0) return;

    const startX = event.clientX;
    const startWidth = width;
    let moved = false;

    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    dragging = true;

    const move = (e: PointerEvent) => {
      const delta = e.clientX - startX;
      if (Math.abs(delta) > DRAG_THRESHOLD) moved = true;
      if (!moved) return;
      // A right-hand panel grows as the pointer moves left.
      onresize(clamp(startWidth + (side === "left" ? delta : -delta)));
    };

    const up = (e: PointerEvent) => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      dragging = false;
      // A press that never moved is a request to collapse or expand.
      if (!moved) ontoggle();
    };

    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  }

  function onkeydown(event: KeyboardEvent) {
    const grow = side === "left" ? "ArrowRight" : "ArrowLeft";
    const shrink = side === "left" ? "ArrowLeft" : "ArrowRight";

    if (event.key === grow) {
      event.preventDefault();
      onresize(clamp(width + STEP));
    } else if (event.key === shrink) {
      event.preventDefault();
      onresize(clamp(width - STEP));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      ontoggle();
    }
  }
</script>

<div
  class="divider"
  class:dragging
  class:closed={!open}
  role="separator"
  tabindex="0"
  aria-orientation="vertical"
  aria-label="{label} — drag to resize, Enter to {open ? 'collapse' : 'expand'}"
  aria-valuenow={open ? width : 0}
  aria-valuemin={0}
  aria-valuemax={max}
  {onpointerdown}
  {onkeydown}
>
  <span class="grip" aria-hidden="true">{open ? (side === "left" ? "‹" : "›") : (side === "left" ? "›" : "‹")}</span>
</div>

<style>
  .divider {
    display: flex;
    align-items: center;
    justify-content: center;
    border-left: 1px solid var(--vs-border-subtle, #e5e5e5);
    border-right: 1px solid var(--vs-border-subtle, #e5e5e5);
    background: var(--vs-bg-panel, #fafafa);
    cursor: col-resize;
    touch-action: none;
    user-select: none;
  }

  .divider.closed {
    cursor: pointer;
  }

  .divider:hover,
  .divider:focus-visible,
  .divider.dragging {
    background: var(--vs-bg-hover, #eee);
  }

  .divider:focus-visible {
    outline: 2px solid var(--vs-accent, #b3510a);
    outline-offset: -2px;
  }

  .grip {
    font-size: 11px;
    line-height: 1;
    color: var(--vs-text-secondary, #999);
    pointer-events: none;
  }

  .divider:hover .grip,
  .divider.dragging .grip {
    color: var(--vs-text-primary, #333);
  }
</style>

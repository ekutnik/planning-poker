import { useEffect, useId, useRef, useState } from "react";
import { TIMER_PRESETS_MS, validDuration } from "../shared/rules.js";
import type { TimerView } from "../shared/snapshot.js";
import type { RoomAction } from "./connection/room-connection.js";
import { freshAnnouncement } from "./announce.js";
import { TIMER_COPY } from "./copy.js";
import {
  formatClock,
  parseClock,
  presetLabel,
  remainingMs,
} from "./countdown.js";

/** How often a running countdown redraws: often enough for whole seconds. */
const TICK_MS = 250;

/**
 * This browser's clock, read when the component mounts and about four times
 * a second after. Only what shows a running or paused timer uses it, and
 * those mount only then, so the first reading is always fresh; ticking on
 * while paused keeps it fresh for Resume. Timer deadlines are already in
 * this clock (inLocalTime).
 */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(interval);
  }, []);
  return now;
}

/** What a running or paused timer has left, now. */
function useLeft(timer: TimerView): number {
  return remainingMs(timer, useNow()) ?? 0;
}

/**
 * The facilitator's timer, beside Reveal votes, while voting. Idle: the
 * duration and Start. Running: what is left, Pause and +30 s. Paused: the
 * time, quiet, with "Paused", Resume and +30 s. Start, Pause and Resume are
 * one button in one place, so focus stays on it as its job changes.
 *
 * While a custom time that is out of range sits in its field, Start is
 * disabled, so a timer never starts with a length nobody meant, and once
 * the field is left (or Enter pressed) the reason shows under the row.
 */
export function TimerControls({
  timer,
  live,
  onAction,
}: {
  readonly timer: TimerView;
  readonly live: boolean;
  readonly onAction: (action: RoomAction) => void;
}) {
  const idle = timer.state === "idle";
  const errorId = useId();
  // The custom field's text: invalid now, and the message once it was
  // committed (left, or Enter). freshAnnouncement repeats it if repeated.
  const [entry, setEntry] = useState<{
    readonly invalid: boolean;
    readonly message: string | null;
  }>({ invalid: false, message: null });
  const blocked = idle && entry.invalid;
  return (
    <div className="timer">
      <div className="timer-row">
        <ClockIcon />
        {idle ? (
          <DurationPicker
            durationMs={timer.durationMs}
            live={live}
            errorId={errorId}
            invalid={entry.message !== null}
            onEntry={(invalid, committed) =>
              setEntry((current) => ({
                invalid,
                message: !invalid
                  ? null
                  : committed
                    ? freshAnnouncement(current.message, TIMER_COPY.invalid)
                    : current.message,
              }))
            }
            onChange={(ms) => onAction({ type: "timerSetDuration", ms })}
          />
        ) : (
          <TimeLeft timer={timer} />
        )}
        <button
          type="button"
          className={idle ? "timer-button" : "timer-button timer-button--icon"}
          disabled={!live || blocked}
          aria-label={
            idle
              ? undefined
              : timer.state === "running"
                ? TIMER_COPY.pause
                : TIMER_COPY.resume
          }
          onClick={() =>
            onAction({
              type: idle
                ? "timerStart"
                : timer.state === "running"
                  ? "timerPause"
                  : "timerResume",
            })
          }
        >
          {idle ? (
            TIMER_COPY.start
          ) : timer.state === "running" ? (
            <PauseIcon />
          ) : (
            <PlayIcon />
          )}
        </button>
        {!idle && (
          <button
            type="button"
            className="timer-button"
            disabled={!live}
            aria-label={TIMER_COPY.addLabel}
            onClick={() => onAction({ type: "timerAdd" })}
          >
            {TIMER_COPY.add}
          </button>
        )}
      </div>
      {idle && (
        <p id={errorId} role="alert" className="field-message timer-error">
          {entry.message}
        </p>
      )}
      {!idle && <TimerBar timer={timer} />}
    </div>
  );
}

/**
 * Everyone else's view of a timer: "1:24 left, then votes are revealed",
 * or "Paused at 1:24", with the bar. Nothing at all while idle.
 */
export function TimerLine({ timer }: { readonly timer: TimerView }) {
  if (timer.state === "idle") return null;
  return <ActiveLine timer={timer} />;
}

/** The facilitator's time: "1:24 left", or quiet with "Paused". */
function TimeLeft({ timer }: { readonly timer: TimerView }) {
  const left = useLeft(timer);
  const paused = timer.state === "paused";
  return (
    <>
      <span className={paused ? "timer-time timer-time--paused" : "timer-time"}>
        {formatClock(left)}
      </span>
      <span className="timer-word">
        {paused ? TIMER_COPY.paused : TIMER_COPY.left}
      </span>
    </>
  );
}

function ActiveLine({ timer }: { readonly timer: TimerView }) {
  const clock = formatClock(useLeft(timer));
  return (
    <div className="timer timer--line">
      <p className="timer-row">
        <ClockIcon />
        {timer.state === "paused" ? (
          <span className="timer-word">{TIMER_COPY.pausedAt(clock)}</span>
        ) : (
          <>
            <span className="timer-time">{clock}</span>{" "}
            <span className="timer-word">{TIMER_COPY.thenRevealed}</span>
          </>
        )}
      </p>
      <TimerBar timer={timer} />
    </div>
  );
}

/**
 * The idle timer's duration: the presets, or Custom… with a small m:ss
 * field. A choice is sent at once; it is the room's, kept across rounds.
 * Custom… shows when the room's duration is no preset (someone else may
 * have set it), or when this person chose it.
 */
function DurationPicker({
  durationMs,
  live,
  errorId,
  invalid,
  onEntry,
  onChange,
}: {
  readonly durationMs: number;
  readonly live: boolean;
  /** The message under the row, which describes the field. */
  readonly errorId: string;
  /** Whether that message is showing. */
  readonly invalid: boolean;
  /** The field's text is valid or not, and whether it was just committed. */
  readonly onEntry: (invalid: boolean, committed: boolean) => void;
  readonly onChange: (ms: number) => void;
}) {
  const selectId = useId();
  const hintId = useId();
  const preset = TIMER_PRESETS_MS.includes(durationMs);
  // Chose Custom… here. Forgotten when the room's duration changes to
  // something this person didn't send, so the select always shows the room.
  const [chose, setChose] = useState(false);
  const [seen, setSeen] = useState(durationMs);
  const [sent, setSent] = useState<number | null>(null);
  if (durationMs !== seen) {
    setSeen(durationMs);
    if (durationMs !== sent) setChose(false);
  }
  const custom = chose || !preset;
  const field = useRef<HTMLInputElement>(null);
  // Choosing Custom… moves focus to its field, once, not on every render.
  const focusField = useRef(false);
  useEffect(() => {
    if (!custom || !focusField.current) return;
    focusField.current = false;
    field.current?.focus();
  }, [custom]);

  const check = (text: string, committed: boolean) => {
    const ms = parseClock(text);
    const ok = ms !== null && validDuration(ms);
    onEntry(!ok, committed);
    if (ok && committed && ms !== durationMs) {
      setSent(ms);
      onChange(ms);
    }
  };

  return (
    <>
      <label htmlFor={selectId} className="timer-label">
        {TIMER_COPY.label}
      </label>
      <select
        id={selectId}
        className="timer-select"
        disabled={!live}
        value={custom ? "custom" : String(durationMs)}
        onChange={(event) => {
          if (event.target.value === "custom") {
            focusField.current = true;
            setChose(true);
            onEntry(false, false);
            return;
          }
          setChose(false);
          onEntry(false, false);
          const ms = Number(event.target.value);
          setSent(ms);
          onChange(ms);
        }}
      >
        {TIMER_PRESETS_MS.map((ms) => (
          <option key={ms} value={String(ms)}>
            {presetLabel(ms)}
          </option>
        ))}
        <option value="custom">{TIMER_COPY.custom}</option>
      </select>
      {custom && (
        <>
          <input
            // A new room duration from someone else shows in the field.
            key={durationMs}
            ref={field}
            className="text-field timer-custom"
            type="text"
            inputMode="numeric"
            aria-label={TIMER_COPY.customLabel}
            aria-describedby={`${hintId} ${errorId}`}
            aria-invalid={invalid}
            placeholder="m:ss"
            defaultValue={formatClock(durationMs)}
            disabled={!live}
            onChange={(event) => check(event.currentTarget.value, false)}
            onKeyDown={(event) => {
              if (event.key === "Enter") check(event.currentTarget.value, true);
            }}
            onBlur={(event) => check(event.currentTarget.value, true)}
          />
          <span id={hintId} className="visually-hidden">
            {TIMER_COPY.customHint}
          </span>
        </>
      )}
    </>
  );
}

/** The 3 px bar: what is left of the duration. Decoration: the time says it. */
function TimerBar({ timer }: { readonly timer: TimerView }) {
  const share = Math.min(1, useLeft(timer) / timer.durationMs);
  return (
    <div className="timer-bar" aria-hidden="true">
      <div
        className="timer-bar-fill"
        style={{ inlineSize: `${String(Math.round(share * 1000) / 10)}%` }}
      />
    </div>
  );
}

const icon = {
  className: "timer-icon",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
} as const;

function ClockIcon() {
  return (
    <svg {...icon}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2.5" />
      <path d="M9 2h6" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg {...icon}>
      <path d="M9 5v14" />
      <path d="M15 5v14" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg {...icon}>
      <path d="M7 5l12 7-12 7z" />
    </svg>
  );
}

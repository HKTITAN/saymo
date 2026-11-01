import type { DatePick } from "./doc";

// Writes the two date lines from the dates picked in the tool, in the
// post's own style: the weekday on the first line (with the time, when
// there is one), the dates on the second.
//   Tuesday,                  Tuesday & Wednesday, 10:30 AM
//   20th October 2026         20th & 21st October 2026

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// "2026-10-20" as a local date, so the weekday never slips a day.
function parse(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export function ordinal(n: number) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

// "14:30" as "2:30 PM"
function clock(value: string) {
  const m = /^(\d{2}):(\d{2})/.exec(value);
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

export function dateLines(pick: DatePick): [string, string] | null {
  const first = parse(pick.start);
  if (!first) return null;
  let last = parse(pick.end) ?? first;
  if (last < first) last = first;
  const days = Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1;
  // Two days read "&", longer runs read "to".
  const join = days === 2 ? " & " : " to ";

  const weekday =
    days === 1 ? WEEKDAYS[first.getDay()] : `${WEEKDAYS[first.getDay()]}${join}${WEEKDAYS[last.getDay()]}`;

  const day = (d: Date) => ordinal(d.getDate());
  const month = (d: Date) => MONTHS[d.getMonth()];
  let dates: string;
  if (days === 1) {
    dates = `${day(first)} ${month(first)} ${first.getFullYear()}`;
  } else if (first.getFullYear() !== last.getFullYear()) {
    dates = `${day(first)} ${month(first)} ${first.getFullYear()}${join}${day(last)} ${month(last)} ${last.getFullYear()}`;
  } else if (first.getMonth() !== last.getMonth()) {
    dates = `${day(first)} ${month(first)}${join}${day(last)} ${month(last)} ${last.getFullYear()}`;
  } else {
    dates = `${day(first)}${join}${day(last)} ${month(last)} ${last.getFullYear()}`;
  }

  const start = clock(pick.time);
  const end = clock(pick.endTime);
  const time = start && end ? `${start} to ${end}` : start;
  return [time ? `${weekday}, ${time}` : `${weekday},`, dates];
}

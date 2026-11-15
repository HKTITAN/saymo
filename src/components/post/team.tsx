import { MARGIN, ordinals } from "./post";
import type { PostContent } from "./content";
import { PALETTE } from "./palette";

// The team post's left side, laid out after the "Speakers announced" card
// the owner shared: a heading, the team in two columns of square photos with
// a name and a role beside each, and the date and place along the foot. On
// black, with the orange in the photo tiles and the roles. Sized for a left
// side widened by the post's panelCut (1120 wide at a cut of 120). As in the
// reference, the grid sits centred between the heading and the foot.
// Each person (photo, name, role) is drawn at 95%: the photos are made at
// 200 by scripts/team-photo.mjs and shown at 190.
const K = 0.95;
export const TEAM_PHOTO = 200 * K;
const ROW_GAP = 36;
const PHOTO_GAP = 28 * K;
const COLUMN_GAP = 32;

// `width` is the whole left side; the two columns share what is left of it
// inside the margins (472 each on a 1120 side).
export function TeamSide({ team, width }: { team: NonNullable<PostContent["team"]>; width: number }) {
  const COLUMN = (width - 2 * MARGIN - COLUMN_GAP) / 2;
  return (
    <div
      className="absolute flex flex-col"
      style={{ left: MARGIN, top: MARGIN, bottom: MARGIN }}
      data-part="team"
    >
      <h1
        className="font-semibold"
        style={{
          fontSize: 76,
          lineHeight: 1,
          letterSpacing: "-0.01em",
          marginTop: -12, // cap height level with the top of the logos
          color: PALETTE.stone,
        }}
      >
        {team.heading}
      </h1>

      <div className="flex flex-1 items-center">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(2, ${COLUMN}px)`,
          columnGap: COLUMN_GAP,
          rowGap: ROW_GAP,
        }}
      >
        {team.members.map((m, i) => (
          <div key={i} className="flex items-center" style={{ gap: PHOTO_GAP }}>
            <div
              className="relative shrink-0 overflow-hidden"
              style={{ width: TEAM_PHOTO, height: TEAM_PHOTO, background: PALETTE.orange }}
            >
              {m.photo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={m.photo.x1}
                  srcSet={`${m.photo.x1} 1x, ${m.photo.x2} 2x`}
                  width={TEAM_PHOTO}
                  height={TEAM_PHOTO}
                  alt={m.name}
                  className="absolute inset-0 block"
                  draggable={false}
                />
              )}
            </div>
            <div style={{ width: COLUMN - TEAM_PHOTO - PHOTO_GAP }}>
              <p
                className="font-semibold whitespace-nowrap"
                style={{ fontSize: 28 * K, lineHeight: 1.15, letterSpacing: "-0.01em", color: PALETTE.stone }}
              >
                {m.name}
              </p>
              <p
                className="font-medium uppercase"
                style={{
                  fontSize: 16 * K,
                  lineHeight: 1.4,
                  letterSpacing: "0.08em",
                  marginTop: 10 * K,
                  color: PALETTE.orange,
                }}
              >
                {m.role}
              </p>
            </div>
          </div>
        ))}
      </div>
      </div>

      {/* The date and place, each under its own column. */}
      <div
        className="grid font-medium uppercase"
        style={{
          gridTemplateColumns: `repeat(2, ${COLUMN}px)`,
          columnGap: COLUMN_GAP,
          fontSize: 22,
          lineHeight: 1,
          letterSpacing: "0.12em",
          color: PALETTE.stone,
        }}
      >
        {team.details.map((d, i) => (
          <p key={i} className="whitespace-nowrap">
            {ordinals(d)}
          </p>
        ))}
      </div>
    </div>
  );
}

// Sphere carousel: cards spread over a turning sphere, with lines from a
// centre card to each of them. Cards at the back go small, soft and faint;
// cards at the front come forward. Inspired by an After Effects sphere
// carousel script (an idea, rebuilt here from scratch for the studio).
//
// It draws from the film's clock, never on its own, so the studio and the
// renderer get exactly the same frame for the same time:
//
//   const sphere = sphereCarousel(document.getElementById("sphere"), {
//     items: [{ src: "assets/logo-1.png" }, { text: "Sourcing" }, ...],
//     center: { text: "SpendOS" },
//   });
//   const tl = filmTimeline(sequence, { duration: FILM.duration, parts: [sphere] });
//
// Load it after timeline.js: <script src="assets/parts/sphere.js"></script>
//
// The container is a positioned element (position: absolute, a size); the
// sphere is centred in it unless `x` and `y` say otherwise. Times are film
// seconds. Everything below is optional except `items`.
//
//   items       cards: { src } an image, { text } a label, { html } markup,
//               { el } an element you made; plus, per card, `size` (px),
//               `lat`/`lon` (degrees) to pin it to a spot on the sphere,
//               `className`, `style` (an object), `id`
//   center      the centre card, the same shape as an item; null for none
//   radius      the sphere's radius in px (default: 36% of the container's
//               shorter side)
//   x, y        the sphere's centre in the container, px
//   card        card size in px (default 120); center.size for the centre
//   corner      card corner radius, as a share of its size (default 0.22)
//   arrange     "sphere" (default, evenly over the whole sphere), "ring"
//               (one ring round the middle), or "rings" (three rings)
//   spin        turns per second about the vertical axis (default 0.04);
//               negative turns the other way; 0 holds still
//   turn        the starting angle, degrees (default 0)
//   tilt        how far the sphere leans towards the viewer, degrees
//               (default 16)
//   wobble      a slow sway of the tilt, degrees (default 0)
//   perspective camera distance in px (default 4 x radius); smaller means
//               stronger perspective
//   depth       how far back looks: { scale: [back, front] (default
//               [0.55, 1.12]), blur: [back, front] px (default [5, 0]),
//               fade: [back, front] (default [0.35, 1]): how much of the
//               card shows; the rest is the fog colour laid over it, so
//               cards stay solid and lines never show through them }
//   fog         the colour cards fade into (default: the page's background)
//   lines       true (default) draws a line from the centre to every card;
//               false for none; or { color, width, opacity: [back, front] }
//   enter       { at, duration, stagger }: cards fly out from the centre and
//               the lines draw on (default: already there at 0)
//   leave       { at, duration, stagger }: the reverse, back into the centre
//   camera      keys for camera moves, eased between: [{ at, zoom, x, y,
//               tilt, turn }]; zoom 1 is as set, x/y pan in px, tilt and
//               turn in degrees added to the sphere's own
//   focus       { index, at, duration }: turns the sphere so card `index`
//               comes to the front at `at` and holds there (overrides spin
//               from then on; a list of these steps through several)
//   cardStyle   styles for every card (an object), e.g. { background, color,
//               font, boxShadow }
//
// The returned part has draw(t) (filmTimeline calls it on every seek),
// cards (the elements, in order), center (its element) and points (where
// each card sits, for anything else that wants to follow them).
(function () {
  const TAU = Math.PI * 2;
  const rad = (d) => (d * Math.PI) / 180;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const mix = (a, b, k) => a + (b - a) * k;
  const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
  // Expo out: fast, then a long soft stop.
  const expoOut = (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p));

  // Even points over a sphere (a Fibonacci spiral), as unit vectors.
  function spherePoints(n) {
    const out = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const a = i * golden;
      out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
    }
    return out;
  }
  function ringPoints(n, y = 0, offset = 0) {
    const r = Math.sqrt(1 - y * y);
    return Array.from({ length: n }, (_, i) => {
      const a = offset + (i / n) * TAU;
      return [Math.cos(a) * r, y, Math.sin(a) * r];
    });
  }
  function ringsPoints(n) {
    const mid = Math.ceil(n * 0.44);
    const top = Math.floor((n - mid) / 2);
    const low = n - mid - top;
    return [...ringPoints(top, 0.62, 0.3), ...ringPoints(mid, 0), ...ringPoints(low, -0.62, 0.6)];
  }
  const fromLatLon = (lat, lon) => {
    const a = rad(lat);
    const b = rad(lon);
    return [Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)];
  };

  // Camera keys, eased between; before the first and after the last, held.
  function cameraAt(keys, t) {
    const base = { zoom: 1, x: 0, y: 0, tilt: 0, turn: 0 };
    if (!keys || !keys.length) return base;
    const sorted = [...keys].sort((a, b) => a.at - b.at).map((k) => ({ ...base, ...k }));
    if (t <= sorted[0].at) return sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1];
      const b = sorted[i];
      if (t <= b.at) {
        const k = easeInOut(clamp((t - a.at) / Math.max(1e-6, b.at - a.at)));
        return { zoom: mix(a.zoom, b.zoom, k), x: mix(a.x, b.x, k), y: mix(a.y, b.y, k), tilt: mix(a.tilt, b.tilt, k), turn: mix(a.turn, b.turn, k) };
      }
    }
    return sorted[sorted.length - 1];
  }

  function makeCard(item, size, corner, cardStyle, isCenter) {
    let el;
    if (item.el instanceof Element) el = item.el;
    else {
      el = document.createElement("div");
      if (item.src) {
        const img = document.createElement("img");
        img.src = item.src;
        img.alt = item.alt ?? "";
        img.draggable = false;
        Object.assign(img.style, { width: "100%", height: "100%", objectFit: item.fit ?? "cover", display: "block" });
        el.append(img);
      } else if (item.html !== undefined) el.innerHTML = item.html;
      else if (item.text !== undefined) {
        el.textContent = item.text;
        Object.assign(el.style, {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: `${Math.round(size * 0.1)}px`,
          fontSize: `${Math.round(size * (isCenter ? 0.16 : 0.14))}px`,
          lineHeight: "1.1",
        });
      }
    }
    el.classList.add(isCenter ? "sphere-center" : "sphere-card");
    // Cards pass behind one another on purpose; tell the film checker so.
    el.setAttribute("data-layout-allow-occlusion", "");
    el.setAttribute("data-layout-allow-overlap", "");
    if (item.className) el.classList.add(...String(item.className).split(/\s+/).filter(Boolean));
    if (item.id) el.id = item.id;
    Object.assign(el.style, {
      position: "absolute",
      left: "0",
      top: "0",
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: `${Math.round(size * corner)}px`,
      overflow: "hidden",
      background: "#1d1d1d",
      color: "#e9e5dd",
      // The film's display face (its brand kit's), else Bricolage Grotesque.
      fontFamily: `"${(window.__brand?.fonts?.find((f) => f.role === "display") ?? window.__brand?.fonts?.[0])?.family ?? "Bricolage Grotesque"}", sans-serif`,
      fontWeight: "600",
      boxShadow: "0 10px 30px rgb(0 0 0 / 0.28)",
      transformOrigin: "50% 50%",
      willChange: "transform, opacity, filter",
      ...cardStyle,
      ...item.style,
    });
    return el;
  }

  function sphereCarousel(container, options = {}) {
    if (!(container instanceof Element)) throw new Error("sphereCarousel needs an element to draw in.");
    const o = options;
    const items = Array.isArray(o.items) ? o.items : [];
    const box = () => ({ w: container.clientWidth || 1920, h: container.clientHeight || 1080 });
    const { w, h } = box();
    const radius = o.radius ?? Math.round(Math.min(w, h) * 0.36);
    const cx = o.x ?? w / 2;
    const cy = o.y ?? h / 2;
    const cardSize = o.card ?? 120;
    const corner = o.corner ?? 0.22;
    const spin = o.spin ?? 0.04;
    const turn0 = rad(o.turn ?? 0);
    const tilt0 = o.tilt ?? 16;
    const wobble = o.wobble ?? 0;
    const persp = o.perspective ?? radius * 4;
    const depth = {
      scale: o.depth?.scale ?? [0.55, 1.12],
      blur: o.depth?.blur ?? [5, 0],
      fade: o.depth?.fade ?? [0.35, 1],
    };
    // The colour far cards fade into: the first background behind the sphere.
    const fogColor =
      o.fog ??
      (() => {
        for (let el = container; el; el = el.parentElement) {
          const bg = getComputedStyle(el).backgroundColor;
          if (bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
        }
        return "#141414";
      })();
    const lineOpts = o.lines === false ? null : { color: "#8a8a8a", width: 1.5, opacity: [0.18, 0.7], ...(typeof o.lines === "object" ? o.lines : {}) };

    // Where each card sits on the unit sphere.
    const layout = o.arrange === "ring" ? ringPoints(items.length) : o.arrange === "rings" ? ringsPoints(items.length) : spherePoints(items.length);
    const points = items.map((it, i) => (Number.isFinite(it.lat) || Number.isFinite(it.lon) ? fromLatLon(it.lat ?? 0, it.lon ?? 0) : layout[i]));

    // The layers: lines under everything, then the cards (stacked by depth
    // each frame), with the centre card at the sphere's middle depth.
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    Object.assign(svg.style, { position: "absolute", left: "0", top: "0", overflow: "visible", pointerEvents: "none", zIndex: "0" });
    svg.classList.add("sphere-lines");
    container.append(svg);
    const lineEls = lineOpts
      ? points.map(() => {
          const l = document.createElementNS(NS, "line");
          l.setAttribute("stroke", lineOpts.color);
          l.setAttribute("stroke-width", String(lineOpts.width));
          l.setAttribute("stroke-linecap", "round");
          svg.append(l);
          return l;
        })
      : [];
    const fogs = [];
    const cards = items.map((it) => {
      const el = makeCard(it, it.size ?? cardSize, corner, o.cardStyle, false);
      const fog = document.createElement("div");
      fog.className = "sphere-fog";
      Object.assign(fog.style, { position: "absolute", inset: "0", background: fogColor, opacity: "0", pointerEvents: "none" });
      el.append(fog);
      fogs.push(fog);
      container.append(el);
      return el;
    });
    const centerSize = o.center?.size ?? Math.round(cardSize * 1.35);
    const centerEl = o.center ? makeCard(o.center, centerSize, corner, o.cardStyle, true) : null;
    if (centerEl) container.append(centerEl);

    const focusSteps = (Array.isArray(o.focus) ? o.focus : o.focus ? [o.focus] : []).filter((f) => Number.isInteger(f.index) && points[f.index]);
    focusSteps.sort((a, b) => a.at - b.at);

    // The sphere's turn at time t: steady spin, or turning to bring a card to
    // the front for each focus step, and holding it there.
    const lonOf = (p) => Math.atan2(p[0], p[2]); // angle about the vertical axis
    function turnAt(t) {
      let base = turn0 + spin * TAU * t;
      for (const f of focusSteps) {
        if (t < f.at) break;
        const dur = f.duration ?? 1.2;
        // The angle that puts the card at the front (facing the viewer).
        const from = turn0 + spin * TAU * f.at;
        let want = -lonOf(points[f.index]);
        // The nearest equivalent angle, so it turns the short way.
        want += Math.round((from - want) / TAU) * TAU;
        const k = easeInOut(clamp((t - f.at) / Math.max(1e-6, dur)));
        base = mix(from, want, k);
      }
      return base;
    }

    const shareOf = (phase, i, t) => {
      if (!phase) return null;
      const k = (t - (phase.at ?? 0) - i * (phase.stagger ?? 0.03)) / Math.max(1e-6, phase.duration ?? 0.9);
      return clamp(k);
    };

    function draw(t) {
      t = Math.max(0, Number(t) || 0);
      const cam = cameraAt(o.camera, t);
      const yaw = turnAt(t) + rad(cam.turn);
      const pitch = rad(tilt0 + cam.tilt + (wobble ? Math.sin(t * 0.6) * wobble : 0));
      const cy0 = Math.cos(yaw);
      const sy0 = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const zoom = cam.zoom;
      const ox = cx + cam.x;
      const oy = cy + cam.y;

      // The centre card.
      let centerZ = 0;
      if (centerEl) {
        const s = zoom;
        centerEl.style.transform = `translate(${ox - centerSize / 2}px, ${oy - centerSize / 2}px) scale(${s})`;
        centerZ = 500;
        centerEl.style.zIndex = String(centerZ);
      }

      points.forEach((p, i) => {
        // Turn about the vertical axis, then lean towards the viewer.
        const x1 = p[0] * cy0 + p[2] * sy0;
        const z1 = -p[0] * sy0 + p[2] * cy0;
        const y2 = p[1] * cp - z1 * sp;
        const z2 = p[1] * sp + z1 * cp;
        // Out from the centre as it enters, back in as it leaves.
        let out = 1;
        const enter = shareOf(o.enter, i, t);
        if (enter !== null) out *= expoOut(enter);
        const leave = shareOf(o.leave, i, t);
        if (leave !== null) out *= 1 - easeInOut(leave);
        const r = radius * out;
        const X = x1 * r;
        const Y = -y2 * r;
        const Z = z2 * r; // towards the viewer is positive
        const f = (persp / (persp - Z)) * zoom;
        const sx = ox + X * f;
        const sy = oy + Y * f;
        const front = (z2 + 1) / 2; // 0 at the back, 1 at the front
        const size = items[i].size ?? cardSize;
        const scale = mix(depth.scale[0], depth.scale[1], front) * f * mix(0.35, 1, out);
        const blur = mix(depth.blur[0], depth.blur[1], front);
        const fade = mix(depth.fade[0], depth.fade[1], front);
        const show = clamp(out * 1.6); // only while flying in or out
        const el = cards[i];
        el.style.transform = `translate(${sx - size / 2}px, ${sy - size / 2}px) scale(${scale})`;
        fogs[i].style.opacity = String(1 - fade);
        el.style.opacity = show >= 1 ? "1" : String(show);
        el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "none";
        // Behind the centre card when at the back, in front when at the front.
        el.style.zIndex = String(Math.round(front * 1000));
        el.style.visibility = show < 0.01 ? "hidden" : "visible";
        const line = lineEls[i];
        if (line) {
          line.setAttribute("x1", String(ox));
          line.setAttribute("y1", String(oy));
          line.setAttribute("x2", String(sx));
          line.setAttribute("y2", String(sy));
          line.setAttribute("stroke-opacity", String(mix(lineOpts.opacity[0], lineOpts.opacity[1], front) * clamp(out)));
        }
      });
      return part;
    }

    const part = { draw, cards, center: centerEl, points, svg };
    draw(0);
    return part;
  }

  window.sphereCarousel = sphereCarousel;
})();

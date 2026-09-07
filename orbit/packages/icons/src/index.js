
export const ORBIT_ICON_PATHS = Object.freeze({
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  account: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M4 21a8 8 0 0 1 16 0'],
  logout: ['M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4', 'M14 8l4 4-4 4', 'M18 12H9'],
  arrowRight: ['M5 12h14', 'M13 6l6 6-6 6'],
  external: ['M14 5h5v5', 'M19 5l-8 8', 'M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  check: ['M5 12l4 4L19 6'],
  alert: ['M12 4l9 16H3L12 4', 'M12 9v4', 'M12 17h.01'],
  social: ['M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M16 20a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M8 8l8 8', 'M16 8l-8 8']
});

export function createOrbitIcon(name, { documentRef = globalThis.document, size = 20, title } = {}) {
  if (!documentRef?.createElementNS) throw new TypeError('A DOM document is required');
  const paths = ORBIT_ICON_PATHS[name];
  if (!paths) throw new TypeError(`Unknown Orbit icon: ${name}`);
  const svg = documentRef.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (title) {
    const titleNode = documentRef.createElementNS('http://www.w3.org/2000/svg', 'title');
    titleNode.textContent = title;
    svg.append(titleNode);
    svg.setAttribute('role', 'img');
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  for (const d of paths) {
    const path = documentRef.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

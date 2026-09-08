# Shared appearance integration

Implemented locally from the approved green/cream and dark forest event-night preview.

- Reuses the existing `koc-theme-v1` device preference. Theme controls do not write event or account data.
- Shared palette covers the event library, public signup, setup, menus, dialogs, qualifiers, seeding, standings and event night. Existing crowned-ball branding is retained.
- Live TV geometry remains standings left, Centre Court above, timer between side courts. The timer consumes the existing timer state and toolbar handlers.
- Standings use the full ranking selector rather than the old 14-team display cap. Pages adapt to available height and rotate every eight seconds; focus/pause stops rotation. Full standings remain available from the menu.
- Eight courts fit at 1920x1080. Smaller landscape tablets can scroll dense court columns; portrait tablets and phones use the existing responsive scoring cards. No scoring or rotation rules changed.
- Small text is raised to 16px. TV labels compensate for canvas scaling; controls retain usable touch targets. Podium spacing reserves room for awards.

## Validation

- `npm test`: 243 tests, including six appearance tests.
- `npm run build`: TypeScript and production build; existing large-bundle warning remains.
- `node scripts/check-appearance.mjs`: 108 viewport/theme/screen combinations; no page errors, document overflow or sub-16px labels outside the scaled canvas. Includes theme/data isolation, persistence, scoring/resume controls, 16-team paging and court/podium clipping assertions.
- `DESIGN_TEST_URL=http://127.0.0.1:4181 node scripts/check-design.mjs`: 16 home/signup viewport/theme combinations, signup validation and create-event dialog checks.

Browser checks use fresh headless Edge contexts and block external traffic. They are responsive emulation, not physical iPad/Safari/AirPlay certification. Dev fixtures are not included in the app entry point or production bundle.

No push, deployment, database migration or live event/registration edits were performed. Before release, try landscape mirroring, scoring, pause/resume, round transition and theme switching on a physical iPad/TV.

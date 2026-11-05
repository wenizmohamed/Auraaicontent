// Z-index scale for the app.  Use these constants instead of inline z-N
// classes so layering is centrally documented and predictable.
//
// Why this exists: 2026-04-25 audit caught the floating AuraAI Assistant
// widget at z-50 colliding with same-z modals — modals on other pages
// were rendering BEHIND the widget, trapping users.  The fix is a clear
// scale where each layer has a distinct rank and a documented purpose.
//
// New code MUST import from here.  Older code with inline z-* classes is
// being migrated piecemeal; see the "still inline" map at the bottom of
// this file for the migration debt list.

export const Z = {
  /** Sidebar nav, always visible behind everything else. */
  sidebar: 20,
  /** Floating widgets (AuraAI Assistant button, pinned bottom-bars).
   *  Sits ABOVE sidebar but BELOW modals so any modal/dialog renders
   *  on top and the user can't be trapped by the widget. */
  widget: 30,
  /** Open chat panels, expanded floating widgets — same rank as
   *  widget so a sibling modal still wins focus. */
  widgetOpen: 30,
  /** Action bars pinned to the page (e.g. Review approve/reject). */
  pinnedBar: 40,
  /** Standard modals — confirm dialogs, edit forms, image previews. */
  modal: 50,
  /** Context menus (right-click, three-dot dropdowns) — above modals
   *  so a menu opened FROM a modal still appears on top. */
  contextMenu: 60,
  /** Right-side drawers (Previous Months history, etc).  Above modals
   *  because drawers are themselves a top-level UX layer that frames
   *  page-scoped modals. */
  drawer: 100,
  /** Toasts and global status bars — always on top. */
  toast: 9999,
} as const;

export type ZLayer = keyof typeof Z;

// Migration debt — files that still inline z-* classes (clean up next round):
//   - apps/desktop/src/App.tsx:64      sidebar (z-20)   matches Z.sidebar OK
//   - apps/desktop/src/App.tsx:69      sidebar collapse btn (z-30)
//   - apps/desktop/src/App.tsx:166     loading overlay (z-50)
//   - apps/desktop/src/App.tsx:203     debug status bar (z-[9999])
//   - apps/desktop/src/lib/toast-context.tsx:62  toasts (z-[9999])
//   - apps/desktop/src/components/VisualRefSearch.tsx:228  preview (z-[60])
//   - apps/desktop/src/pages/BriefInput.tsx:339,383   modals (z-50)
//   - apps/desktop/src/pages/ContentCalendar.tsx:881  drawer (z-[100])
//   - apps/desktop/src/pages/ContentPieces.tsx:831,880  bulk-bar + modal (z-50)
//   - apps/desktop/src/pages/ContentReview.tsx:1083,1156,1179  modal + bars
//   - apps/desktop/src/pages/CreativeTools.tsx:697  modal (z-50)
//   - apps/desktop/src/pages/DesignTextures.tsx:216,249  modals (z-50)
//   - apps/desktop/src/pages/Studio.tsx:558,617  modals (z-50)
//   - apps/desktop/src/pages/TopicDesk.tsx:706,881,1071,1100,1193  modals + menus

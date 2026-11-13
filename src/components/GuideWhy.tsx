// A note for the on-screen guide, written by the page itself: "the button X is not here because…".
//
// Many buttons only exist in one state of a record (a quote can be presented only when its list has no open
// points). When a step of the guide names a button that this page is not showing, the guide looks for this note
// and tells the person the reason, and marks the block the note sits in (or the nearest `data-guide-block`).
// It renders nothing visible. `button` is the Spanish text of the button, exactly as the Guía de campo writes it.
export function GuideWhy({ button, children }: { button: string; children: React.ReactNode }) {
  return <span hidden data-guide-for={button}>{children}</span>;
}

/**
 * Spotlight overlay that dims the page and cuts out the highlighted element.
 * Uses box-shadow technique for the cutout effect with smooth transitions.
 */

import type { CSSProperties } from 'react';

/** Padding (px) around the target element for visual breathing room */
const SPOTLIGHT_PADDING = 6;
const SPOTLIGHT_BORDER_RADIUS = 8;
const BACKDROP_COLOR = 'rgba(0, 0, 0, 0.7)';
const BACKDROP_SPREAD = '9999px';

interface TutorialSpotlightProps {
  readonly targetRect: DOMRect;
}

/** Builds the inline styles for the spotlight cutout element */
const buildSpotlightStyle = (rect: DOMRect): CSSProperties => ({
  position: 'absolute',
  top: rect.top - SPOTLIGHT_PADDING,
  left: rect.left - SPOTLIGHT_PADDING,
  width: rect.width + SPOTLIGHT_PADDING * 2,
  height: rect.height + SPOTLIGHT_PADDING * 2,
  borderRadius: SPOTLIGHT_BORDER_RADIUS,
  boxShadow: `0 0 0 ${BACKDROP_SPREAD} ${BACKDROP_COLOR}`,
  transition: 'all 0.3s ease-in-out',
});

export const TutorialSpotlight: React.FC<TutorialSpotlightProps> = ({ targetRect }) => (
  <div className="fixed inset-0 z-[60] pointer-events-none">
    <div style={buildSpotlightStyle(targetRect)} />
  </div>
);

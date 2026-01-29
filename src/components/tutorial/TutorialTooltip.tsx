/**
 * Tooltip card displayed near the highlighted tutorial element.
 * Shows step content and navigation controls (Back, Next/Get Started, Skip).
 */

import { useEffect } from 'react';
import type { TutorialStep, TooltipPosition } from '../../constants/tutorialSteps';

/** Tooltip card dimensions for position calculations */
const TOOLTIP_WIDTH = 320;
const TOOLTIP_HEIGHT_ESTIMATE = 180;
const VIEWPORT_PADDING = 16;

interface TutorialTooltipProps {
  readonly step: TutorialStep;
  readonly stepIndex: number;
  readonly totalSteps: number;
  readonly targetRect: DOMRect;
  readonly onNext: () => void;
  readonly onPrev: () => void;
  readonly onSkip: () => void;
}

/** Calculated position for the tooltip */
interface TooltipCoords {
  top: number;
  left: number;
}

/** Computes tooltip position, flipping if it overflows the viewport */
const calculatePosition = (
  rect: DOMRect,
  preferred: TooltipPosition
): TooltipCoords => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = 0;
  let left = 0;

  const centerX = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
  const centerY = rect.top + rect.height / 2 - TOOLTIP_HEIGHT_ESTIMATE / 2;

  switch (preferred) {
    case 'bottom':
      top = rect.bottom + VIEWPORT_PADDING;
      left = centerX;
      if (top + TOOLTIP_HEIGHT_ESTIMATE > vh) top = rect.top - TOOLTIP_HEIGHT_ESTIMATE - VIEWPORT_PADDING;
      break;
    case 'top':
      top = rect.top - TOOLTIP_HEIGHT_ESTIMATE - VIEWPORT_PADDING;
      left = centerX;
      if (top < 0) top = rect.bottom + VIEWPORT_PADDING;
      break;
    case 'right':
      top = centerY;
      left = rect.right + VIEWPORT_PADDING;
      if (left + TOOLTIP_WIDTH > vw) left = rect.left - TOOLTIP_WIDTH - VIEWPORT_PADDING;
      break;
    case 'left':
      top = centerY;
      left = rect.left - TOOLTIP_WIDTH - VIEWPORT_PADDING;
      if (left < 0) left = rect.right + VIEWPORT_PADDING;
      break;
  }

  return {
    top: clamp(top, VIEWPORT_PADDING, vh - TOOLTIP_HEIGHT_ESTIMATE - VIEWPORT_PADDING),
    left: clamp(left, VIEWPORT_PADDING, vw - TOOLTIP_WIDTH - VIEWPORT_PADDING),
  };
};

/** Clamps a value between min and max */
const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

export const TutorialTooltip: React.FC<TutorialTooltipProps> = ({
  step,
  stepIndex,
  totalSteps,
  targetRect,
  onNext,
  onPrev,
  onSkip,
}) => {
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === totalSteps - 1;
  const coords = calculatePosition(targetRect, step.tooltipPosition);

  // Dismiss on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSkip();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSkip]);

  return (
    <div
      role="dialog"
      aria-label={step.title}
      className="fixed z-[61] pointer-events-auto"
      style={{
        top: coords.top,
        left: coords.left,
        width: TOOLTIP_WIDTH,
        transition: 'all 0.3s ease-in-out',
      }}
    >
      <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-4">
        <TooltipHeader title={step.title} stepIndex={stepIndex} totalSteps={totalSteps} />
        <p className="text-sm text-gray-300 mb-4">{step.description}</p>
        <TooltipNav
          isFirstStep={isFirstStep}
          isLastStep={isLastStep}
          onPrev={onPrev}
          onNext={onNext}
          onSkip={onSkip}
        />
      </div>
    </div>
  );
};

/** Step title and counter */
const TooltipHeader: React.FC<{
  title: string;
  stepIndex: number;
  totalSteps: number;
}> = ({ title, stepIndex, totalSteps }) => (
  <div className="flex items-center justify-between mb-2">
    <h3 className="text-base font-semibold text-white">{title}</h3>
    <span className="text-xs text-gray-500">
      {stepIndex + 1} / {totalSteps}
    </span>
  </div>
);

/** Navigation buttons: Back, Next/Get Started, Skip */
const TooltipNav: React.FC<{
  isFirstStep: boolean;
  isLastStep: boolean;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
}> = ({ isFirstStep, isLastStep, onPrev, onNext, onSkip }) => (
  <div className="flex items-center justify-between">
    <button
      onClick={onSkip}
      className="text-xs text-gray-500 hover:text-gray-300 transition"
    >
      Skip
    </button>
    <div className="flex gap-2">
      {!isFirstStep && (
        <button
          onClick={onPrev}
          className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded transition"
        >
          Back
        </button>
      )}
      <button
        onClick={onNext}
        className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded transition"
      >
        {isLastStep ? 'Get Started' : 'Next'}
      </button>
    </div>
  </div>
);

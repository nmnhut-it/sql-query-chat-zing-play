/**
 * Tutorial orchestrator: manages step targeting, position tracking,
 * and renders the spotlight + tooltip overlay.
 */

import { useState, useEffect, useCallback } from 'react';
import { TutorialSpotlight } from './TutorialSpotlight';
import { TutorialTooltip } from './TutorialTooltip';
import { getTutorialSelector } from '../../constants/tutorialSteps';
import type { TutorialStep, RequiredTab } from '../../constants/tutorialSteps';
import type { TutorialStepId } from '../../constants/tutorialSteps';
import type { UseTutorialReturn } from '../../hooks/useTutorial';

interface TutorialProps {
  readonly tutorial: UseTutorialReturn;
  /** Called when a step requires a specific tab to be active */
  readonly onTabChange?: (tab: RequiredTab) => void;
  /** Called when a new step becomes active (for demo actions) */
  readonly onStepEnter?: (stepId: TutorialStepId) => void;
}

/** Finds the DOM element for the current tutorial step */
const findStepTarget = (step: TutorialStep): HTMLElement | null =>
  document.querySelector<HTMLElement>(getTutorialSelector(step));

export const Tutorial: React.FC<TutorialProps> = ({ tutorial, onTabChange, onStepEnter }) => {
  const { isActive, currentStep, currentStepIndex, totalSteps, nextStep, prevStep, skipTutorial } = tutorial;
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  /** Updates the target element position from the DOM */
  const updatePosition = useCallback(() => {
    if (!currentStep) return;
    const target = findStepTarget(currentStep);
    if (target) {
      setTargetRect(target.getBoundingClientRect());
    } else {
      setTargetRect(null);
    }
  }, [currentStep]);

  // Switch tab, fire step action, then update position
  useEffect(() => {
    if (!isActive || !currentStep) return;
    if (currentStep.requiredTab && onTabChange) {
      onTabChange(currentStep.requiredTab);
    }
    onStepEnter?.(currentStep.id);
    // Allow React to render any state changes before measuring
    requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [isActive, currentStep, onTabChange, onStepEnter, updatePosition]);

  // Skip step if target element not found
  useEffect(() => {
    if (isActive && currentStep && !targetRect) {
      const target = findStepTarget(currentStep);
      if (!target) nextStep();
    }
  }, [isActive, currentStep, targetRect, nextStep]);

  if (!isActive || !targetRect) return null;

  return (
    <>
      {/* Clickable backdrop to dismiss */}
      <div
        className="fixed inset-0 z-[59]"
        onClick={skipTutorial}
        aria-hidden="true"
      />
      <TutorialSpotlight targetRect={targetRect} />
      <TutorialTooltip
        step={currentStep}
        stepIndex={currentStepIndex}
        totalSteps={totalSteps}
        targetRect={targetRect}
        onNext={nextStep}
        onPrev={prevStep}
        onSkip={skipTutorial}
      />
    </>
  );
};

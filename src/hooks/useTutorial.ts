/**
 * Hook for managing the interactive tutorial lifecycle.
 * Handles step navigation, first-visit auto-start, and localStorage persistence.
 */

import { useState, useEffect, useCallback } from 'react';
import { STORAGE_KEYS } from '../constants/aiPrompts';
import { TUTORIAL_STEPS } from '../constants/tutorialSteps';
import type { TutorialStep } from '../constants/tutorialSteps';

/** Return type for the useTutorial hook */
export interface UseTutorialReturn {
  isActive: boolean;
  currentStep: TutorialStep;
  currentStepIndex: number;
  totalSteps: number;
  nextStep: () => void;
  prevStep: () => void;
  skipTutorial: () => void;
  startTutorial: () => void;
}

/** Checks whether the tutorial has been completed before */
const isTutorialCompleted = (): boolean =>
  localStorage.getItem(STORAGE_KEYS.TUTORIAL_COMPLETED) === 'true';

/** Marks the tutorial as completed in localStorage */
const markTutorialCompleted = (): void =>
  localStorage.setItem(STORAGE_KEYS.TUTORIAL_COMPLETED, 'true');

export const useTutorial = (): UseTutorialReturn => {
  const [isActive, setIsActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Auto-start on first visit (no localStorage key)
  useEffect(() => {
    if (!isTutorialCompleted()) {
      setIsActive(true);
    }
  }, []);

  const completeTutorial = useCallback(() => {
    markTutorialCompleted();
    setIsActive(false);
    setCurrentStepIndex(0);
  }, []);

  const skipTutorial = useCallback(() => {
    completeTutorial();
  }, [completeTutorial]);

  const nextStep = useCallback(() => {
    if (currentStepIndex >= TUTORIAL_STEPS.length - 1) {
      completeTutorial();
    } else {
      setCurrentStepIndex((prev) => prev + 1);
    }
  }, [currentStepIndex, completeTutorial]);

  const prevStep = useCallback(() => {
    setCurrentStepIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const startTutorial = useCallback(() => {
    setCurrentStepIndex(0);
    setIsActive(true);
  }, []);

  return {
    isActive,
    currentStep: TUTORIAL_STEPS[currentStepIndex],
    currentStepIndex,
    totalSteps: TUTORIAL_STEPS.length,
    nextStep,
    prevStep,
    skipTutorial,
    startTutorial,
  };
};

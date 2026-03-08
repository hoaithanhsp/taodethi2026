
import React from 'react';
import { AppStep } from '../types';
import { CheckCircle2 } from 'lucide-react';

interface Props {
  currentStep: AppStep;
  setStep: (step: AppStep) => void;
  completedSteps: number;
}

const steps = [
  { id: AppStep.INPUT, label: 'Thông tin' },
  { id: AppStep.MATRIX, label: 'Ma trận' },
  { id: AppStep.SPECS, label: 'Bảng đặc tả' },
  { id: AppStep.EXAM, label: 'Đề thi' },
];

const StepIndicator: React.FC<Props> = ({ currentStep, setStep, completedSteps }) => {
  return (
    <div className="w-full shrink-0">
      <div className="step-bar-floating">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          {steps.map((step, index) => {
            const isActive = currentStep === step.id;
            const isCompleted = step.id <= completedSteps;
            const isClickable = step.id <= completedSteps;

            return (
              <React.Fragment key={step.id}>
                <div
                  onClick={() => isClickable && setStep(step.id)}
                  className={`flex items-center gap-2.5 cursor-pointer transition-all duration-200 ${!isClickable ? 'pointer-events-none opacity-40' : 'hover:scale-105'}`}
                >
                  {isActive ? (
                    <div className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center font-bold text-sm step-active-glow">
                      {index + 1}
                    </div>
                  ) : isCompleted ? (
                    <div className="w-9 h-9 rounded-full bg-emerald-50 flex items-center justify-center">
                      <CheckCircle2 className="w-7 h-7 text-emerald-500" />
                    </div>
                  ) : (
                    <div className="w-9 h-9 rounded-full border-2 border-slate-200 text-slate-400 flex items-center justify-center font-medium text-sm bg-white">
                      {index + 1}
                    </div>
                  )}
                  <span className={`text-sm font-semibold transition-colors ${isActive ? 'text-primary' : isCompleted ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {step.label}
                  </span>
                </div>
                {index < steps.length - 1 && (
                  <div className="h-[3px] flex-1 bg-slate-100 mx-4 rounded-full relative overflow-hidden">
                    <div
                      className="absolute top-0 left-0 h-full progress-gradient transition-all duration-700 ease-out"
                      style={{ width: step.id < completedSteps ? '100%' : '0%' }}
                    ></div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default StepIndicator;

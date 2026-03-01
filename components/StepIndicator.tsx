import React from 'react';
import { AppStep } from '../types';
import { CheckCircle2, Circle, ChevronRight } from 'lucide-react';

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
    <div className="w-full bg-white border-b border-slate-200 py-4 px-6 mb-6">
      <div className="flex items-center justify-between max-w-4xl mx-auto">
        {steps.map((step, index) => {
          const isActive = currentStep === step.id;
          const isCompleted = step.id <= completedSteps;
          const isClickable = step.id <= completedSteps;

          return (
            <React.Fragment key={step.id}>
              <div 
                onClick={() => isClickable && setStep(step.id)}
                className={`flex items-center gap-2 cursor-pointer transition-colors ${!isClickable ? 'pointer-events-none opacity-50' : ''}`}
              >
                {isActive ? (
                  <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center font-bold text-sm shadow-md ring-2 ring-primary ring-offset-2">
                    {index + 1}
                  </div>
                ) : isCompleted ? (
                  <CheckCircle2 className="w-8 h-8 text-green-500" />
                ) : (
                  <div className="w-8 h-8 rounded-full border-2 border-slate-300 text-slate-400 flex items-center justify-center font-medium text-sm">
                    {index + 1}
                  </div>
                )}
                <span className={`text-sm font-medium ${isActive ? 'text-primary' : 'text-slate-600'}`}>
                  {step.label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div className="h-[2px] flex-1 bg-slate-200 mx-4 relative">
                    <div 
                        className="absolute top-0 left-0 h-full bg-green-500 transition-all duration-500" 
                        style={{ width: step.id < completedSteps ? '100%' : '0%' }}
                    ></div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default StepIndicator;

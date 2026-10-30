import React, { useState } from 'react';
import { getWordMathFormat, setWordMathFormat, WordMathFormat } from '../services/wordEquation';

const HELP =
  'Cách ghi công thức trong file Word:\n' +
  '• LaTeX ($...$): giữ nguyên mã LaTeX như trước.\n' +
  '• Equation: công thức Equation của Word, sửa được ngay trong Word. ' +
  'Muốn đổi sang MathType: mở file > tab MathType > Convert Equations > chọn "Microsoft Word equations" > Convert.';

/** Ô chọn dạng công thức khi xuất Word. Lựa chọn được nhớ cho các lần xuất sau (mọi trang). */
const MathFormatSelect: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [format, setFormat] = useState<WordMathFormat>(getWordMathFormat);

  return (
    <label className={`flex items-center gap-1.5 text-xs text-slate-600 ${className}`} title={HELP}>
      <span className="whitespace-nowrap">Công thức:</span>
      <select
        value={format}
        onChange={e => {
          const next = e.target.value as WordMathFormat;
          setFormat(next);
          setWordMathFormat(next);
        }}
        className="border border-slate-300 rounded-md px-1.5 py-1 bg-white text-slate-700 text-xs focus:outline-none focus:ring-1 focus:ring-teal-400"
      >
        <option value="latex">LaTeX ($...$)</option>
        <option value="equation">Equation (đổi MathType được)</option>
      </select>
    </label>
  );
};

export default MathFormatSelect;

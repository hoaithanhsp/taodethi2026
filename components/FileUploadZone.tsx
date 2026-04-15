import React, { useCallback, useState, useRef } from 'react';
import { Upload, FileText, X, AlertCircle } from 'lucide-react';

interface FileUploadZoneProps {
  onFileSelect: (fileData: { base64: string; mimeType: string; name: string }) => void;
  selectedFileName?: string | null;
  onClear?: () => void;
  isLoading?: boolean;
  accept?: string;
  maxSizeMB?: number;
  label?: string;
  sublabel?: string;
}

const FileUploadZone: React.FC<FileUploadZoneProps> = ({
  onFileSelect,
  selectedFileName,
  onClear,
  isLoading = false,
  accept = '.pdf,.jpg,.jpeg,.png,.webp',
  maxSizeMB = 20,
  label = 'Kéo thả đề thi vào đây',
  sublabel = 'hoặc click để chọn file',
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((file: File) => {
    setError(null);

    const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setError('Chỉ hỗ trợ PDF hoặc hình ảnh (JPG, PNG, WEBP).');
      return;
    }

    if (file.size > maxSizeMB * 1024 * 1024) {
      setError(`File quá lớn. Vui lòng chọn file dưới ${maxSizeMB}MB.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = (e.target?.result as string).split(',')[1];
      onFileSelect({
        base64,
        mimeType: file.type,
        name: file.name,
      });
    };
    reader.readAsDataURL(file);
  }, [onFileSelect, maxSizeMB]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) processFile(e.dataTransfer.files[0]);
  }, [processFile]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) processFile(e.target.files[0]);
    if (inputRef.current) inputRef.current.value = '';
  }, [processFile]);

  // Show selected file state
  if (selectedFileName && !isLoading) {
    return (
      <div className="w-full">
        <div className="flex items-center justify-between p-4 rounded-xl border-2 border-teal-200 bg-teal-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-teal-100 flex items-center justify-center">
              <FileText className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-teal-800 truncate max-w-xs">{selectedFileName}</p>
              <p className="text-xs text-teal-500">Đã tải lên · Click xóa để chọn file khác</p>
            </div>
          </div>
          {onClear && (
            <button
              onClick={onClear}
              className="p-2 rounded-lg hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div
        className={`relative flex flex-col items-center justify-center w-full h-52 border-2 border-dashed rounded-2xl transition-all duration-300 cursor-pointer
          ${dragActive ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-white hover:bg-teal-50/30 hover:border-teal-300'}
          ${isLoading ? 'opacity-50 pointer-events-none' : ''}
        `}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        {isLoading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-3 border-teal-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium text-teal-700">Đang xử lý...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 px-4 text-center">
            <div className="w-14 h-14 rounded-full bg-teal-100 flex items-center justify-center">
              <Upload className="w-6 h-6 text-teal-600" />
            </div>
            <div>
              <p className="text-base font-semibold text-slate-700">{label}</p>
              <p className="text-sm text-slate-500 mt-1">{sublabel}</p>
            </div>
            <p className="text-xs text-slate-400">
              Hỗ trợ PDF, JPG, PNG (Max {maxSizeMB}MB)
            </p>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={handleChange}
          disabled={isLoading}
          accept={accept}
        />
      </div>

      {error && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
};

export default FileUploadZone;

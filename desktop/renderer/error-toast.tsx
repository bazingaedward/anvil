import { createPortal } from "react-dom";
import { CircleAlert, X } from "lucide-react";

export function ErrorToast({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss(): void;
}) {
  if (!message) return null;
  const detail = message.replace(
    /^(?:Error:\s*)*(?:Error invoking remote method '[^']+':\s*)?(?:Error:\s*)*/,
    "",
  );
  return createPortal(
    <div className="error-toast" role="alert" aria-atomic="true">
      <CircleAlert size={21} aria-hidden="true" />
      <div className="error-toast-content">
        <strong>操作失败</strong>
        <p>{detail}</p>
      </div>
      <button type="button" aria-label="关闭错误提示" onClick={onDismiss}>
        <X size={18} aria-hidden="true" />
      </button>
    </div>,
    document.body,
  );
}

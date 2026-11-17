import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImageIcon, Paperclip, X } from "lucide-react";
import type { Attachment } from "../shared/api";

function ImagePreview({
  name,
  src,
  onClose,
}: {
  name: string;
  src: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="attachment-preview"
      aria-label={name}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header>
        <span>{name}</span>
        <button autoFocus onClick={onClose} aria-label="关闭图片预览">
          <X size={20} />
        </button>
      </header>
      <img src={src} alt={name} />
    </dialog>,
    document.body,
  );
}

function MessageImage({ file }: { file: Attachment }) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    setSrc("");
    setFailed(false);
    setOpen(false);
    window.anvil.imagePreview(file.id).then(
      (value) => {
        if (active) setSrc(value);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [file.id]);
  return (
    <>
      <button
        className="message-image"
        disabled={!src || failed}
        aria-label={`预览图片：${file.name}`}
        title={file.name}
        onClick={() => setOpen(true)}
      >
        {src && !failed ? (
          <img src={src} alt={file.name} onError={() => setFailed(true)} />
        ) : (
          <span>
            <ImageIcon size={24} />
            <span>{file.name}</span>
            <small>{failed ? "图片无法加载" : "加载图片…"}</small>
          </span>
        )}
      </button>
      {open && (
        <ImagePreview
          name={file.name}
          src={src}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function UserMessage({
  text,
  attachments = [],
}: {
  text: string;
  attachments?: Attachment[];
}) {
  const images = attachments.filter((file) => file.mime.startsWith("image/"));
  const files = attachments.filter((file) => !file.mime.startsWith("image/"));
  return (
    <div className="agent-prompt">
      {images.length > 0 && (
        <div className="message-images">
          {images.map((file) => (
            <MessageImage key={file.id} file={file} />
          ))}
        </div>
      )}
      {text && <div>{text}</div>}
      {files.length > 0 && (
        <div className="sent-attachments">
          {files.map((file) => (
            <span key={file.id}>
              <Paperclip size={13} />
              {file.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

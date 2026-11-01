import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArchiveRestore,
  Check,
  Ellipsis,
  Pencil,
  Trash2,
  X,
} from "lucide-react";

export function ConversationRow({
  title,
  selected,
  archived,
  running,
  disabled,
  onSelect,
  onRename,
  onArchive,
  onDelete,
}: {
  title: string;
  selected: boolean;
  archived: boolean;
  running: boolean;
  disabled: boolean;
  onSelect: () => void;
  onRename: (title: string) => Promise<unknown>;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const rect = menu.current.getBoundingClientRect();
    setPosition({
      left: Math.max(
        8,
        Math.min(anchor.right - rect.width, window.innerWidth - rect.width - 8),
      ),
      top: Math.max(
        8,
        Math.min(anchor.bottom + 5, window.innerHeight - rect.height - 8),
      ),
    });
    menu.current
      .querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const close = () => setOpen(false);
    const scroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [open]);
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      await onRename(name.trim());
      setEditing(false);
      trigger.current?.focus();
    } catch (error) {
      setError(String(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div
      className={`conversation-row ${selected ? "selected" : ""} ${open ? "menu-open" : ""}`}
    >
      {editing ? (
        <form
          className="conversation-row-rename"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <input
            ref={input}
            aria-label="Conversation title"
            maxLength={120}
            value={name}
            disabled={saving}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !saving) {
                setEditing(false);
                trigger.current?.focus();
              }
            }}
          />
          <button
            type="submit"
            aria-label="Save title"
            disabled={saving || !name.trim()}
          >
            <Check size={15} />
          </button>
          <button
            type="button"
            aria-label="Cancel rename"
            disabled={saving}
            onClick={() => setEditing(false)}
          >
            <X size={15} />
          </button>
          {error && (
            <span className="rename-error" role="alert">
              {error}
            </span>
          )}
        </form>
      ) : (
        <>
          <button
            className="draft-item"
            aria-current={selected ? "true" : undefined}
            title={title}
            disabled={disabled}
            onClick={onSelect}
          >
            <span>{title}</span>
            {running && <span className="activity-dot" aria-label="Running" />}
          </button>
          <button
            ref={trigger}
            className="conversation-row-more"
            aria-label={`Actions for ${title}`}
            title="Conversation actions"
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={disabled}
            onClick={() => setOpen((value) => !value)}
          >
            <Ellipsis size={17} />
          </button>
        </>
      )}
      {open &&
        createPortal(
          <div
            ref={menu}
            className="conversation-row-menu"
            role="menu"
            aria-label={`Actions for ${title}`}
            style={position}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                close();
              }
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const buttons = Array.from(
                  menu.current?.querySelectorAll<HTMLButtonElement>(
                    "button:not(:disabled)",
                  ) || [],
                );
                const index = buttons.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? buttons.length - 1
                      : (index +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          buttons.length) %
                        buttons.length;
                buttons[next]?.focus();
              }
              if (event.key === "Tab") setOpen(false);
            }}
          >
            <button
              role="menuitem"
              onClick={() => {
                close();
                setName(title);
                setError("");
                setEditing(true);
              }}
            >
              <Pencil size={17} />
              Rename
            </button>
            <button
              role="menuitem"
              disabled={running}
              title={running ? "Stop the task before archiving" : undefined}
              onClick={() => {
                close();
                onArchive();
              }}
            >
              {archived ? <ArchiveRestore size={17} /> : <Archive size={17} />}
              {archived ? "Restore" : "Archive"}
            </button>
            <div className="conversation-menu-separator" role="separator" />
            <button
              role="menuitem"
              className="delete-conversation"
              onClick={() => {
                close();
                onDelete();
              }}
            >
              <Trash2 size={17} />
              Delete
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

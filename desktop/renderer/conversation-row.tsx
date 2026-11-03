import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Pin,
  Folder,
  ChevronRight,
  ChevronDown,
  Archive,
  ArchiveRestore,
  Check,
  Ellipsis,
  Pencil,
  Trash2,
  X,
} from "lucide-react";

import type { ConversationGroup } from "../shared/api";

export function ConversationRow({
  title,
  groups,
  groupID,
  pinned,
  onPin,
  onMove,
  onCreateGroup,
  collapsed,
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
  groups?: ConversationGroup[];
  groupID?: string | null;
  pinned?: boolean;
  onPin?: () => void;
  onMove?: (id: string | null) => void;
  onCreateGroup?: (name: string) => Promise<void>;
  collapsed?: boolean;
  selected: boolean;
  archived: boolean;
  running: boolean;
  disabled: boolean;
  onSelect: () => void;
  onRename: (title: string) => Promise<unknown>;
  onArchive?: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupError, setGroupError] = useState("");
  const [groupSaving, setGroupSaving] = useState(false);
  const [subPosition, setSubPosition] = useState({ left: 0, top: 0 });
  const submenu = useRef<HTMLDivElement>(null);
  const moveTrigger = useRef<HTMLButtonElement>(null);
  const focusSubmenu = useRef(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
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
  useLayoutEffect(() => {
    if (
      !open ||
      !moving ||
      !submenu.current ||
      !moveTrigger.current ||
      !menu.current
    )
      return;
    const anchor = moveTrigger.current.getBoundingClientRect();
    const parent = menu.current.getBoundingClientRect();
    const rect = submenu.current.getBoundingClientRect();
    const right = parent.right + 4;
    const left =
      right + rect.width <= window.innerWidth - 8
        ? right
        : parent.left - rect.width - 4;
    setSubPosition({
      left: Math.max(8, Math.min(left, window.innerWidth - rect.width - 8)),
      top: Math.max(
        8,
        Math.min(anchor.top, window.innerHeight - rect.height - 8),
      ),
    });
    if (focusSubmenu.current) {
      submenu.current
        .querySelector<HTMLElement>(creatingGroup ? "input" : "button")
        ?.focus();
      focusSubmenu.current = false;
    }
  }, [open, moving, creatingGroup, groups?.length, position, groupError]);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  function keepSubmenu() {
    clearTimeout(leaveTimer.current);
  }
  function leaveSubmenu() {
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => {
      if (!creatingGroup && !submenu.current?.contains(document.activeElement))
        setMoving(false);
    }, 180);
  }
  function showSubmenu(keyboard = false) {
    keepSubmenu();
    focusSubmenu.current = keyboard;
    setMoving(true);
    if (keyboard && moving)
      submenu.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }
  async function createAndMove() {
    if (!groupName.trim() || groupSaving || !onCreateGroup) return;
    setGroupSaving(true);
    setGroupError("");
    try {
      await onCreateGroup(groupName.trim());
      close();
    } catch (error) {
      setGroupError(String(error));
    } finally {
      setGroupSaving(false);
    }
  }
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !submenu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const close = () => setOpen(false);
    const scroll = (event: Event) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !submenu.current?.contains(event.target as Node)
      )
        close();
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
    setMoving(false);
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
            aria-label={
              collapsed === undefined ? "Conversation title" : "Group name"
            }
            maxLength={collapsed === undefined ? 120 : 80}
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
            aria-expanded={collapsed === undefined ? undefined : !collapsed}
            title={title}
            disabled={disabled}
            onClick={onSelect}
          >
            {collapsed !== undefined &&
              (collapsed ? (
                <ChevronRight size={14} />
              ) : (
                <ChevronDown size={14} />
              ))}
            {pinned && <Pin size={13} />}
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
            onClick={() => {
              setMoving(false);
              setCreatingGroup(false);
              setGroupName("");
              setGroupError("");
              setOpen((value) => !value);
            }}
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
            onPointerOver={(event) => {
              if (
                (event.target as HTMLElement).closest("button") &&
                (event.target as HTMLElement).closest("button") !==
                  moveTrigger.current &&
                !creatingGroup
              )
                setMoving(false);
            }}
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
            {onPin && (
              <button
                role="menuitem"
                onClick={() => {
                  close();
                  onPin();
                }}
              >
                <Pin size={17} />
                {pinned ? "Unpin" : "Pin"}
              </button>
            )}
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
            {onMove && (
              <button
                ref={moveTrigger}
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={moving}
                className={moving ? "submenu-active" : undefined}
                onPointerEnter={() => showSubmenu()}
                onPointerLeave={leaveSubmenu}
                onClick={() => showSubmenu(true)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    showSubmenu(true);
                  }
                }}
              >
                <Folder size={17} />
                Move to group
                <ChevronRight size={15} />
              </button>
            )}
            {onArchive && (
              <button
                role="menuitem"
                disabled={running}
                title={running ? "Stop the task before archiving" : undefined}
                onClick={() => {
                  close();
                  onArchive();
                }}
              >
                {archived ? (
                  <ArchiveRestore size={17} />
                ) : (
                  <Archive size={17} />
                )}
                {archived ? "Restore" : "Archive"}
              </button>
            )}
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
              {collapsed === undefined ? "Delete" : "Delete group"}
            </button>
          </div>,
          document.body,
        )}
      {open &&
        moving &&
        createPortal(
          <div
            ref={submenu}
            className="conversation-row-menu group-submenu"
            style={subPosition}
            role={creatingGroup ? "dialog" : "menu"}
            aria-label={creatingGroup ? "New group" : "Move to group"}
            onPointerEnter={keepSubmenu}
            onPointerLeave={leaveSubmenu}
            onKeyDown={(event) => {
              if (
                event.key === "Escape" ||
                (!creatingGroup && event.key === "ArrowLeft")
              ) {
                event.preventDefault();
                event.stopPropagation();
                if (!groupSaving) {
                  setCreatingGroup(false);
                  setMoving(false);
                  moveTrigger.current?.focus();
                }
              }
              if (
                !creatingGroup &&
                ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                const buttons = Array.from(
                  submenu.current?.querySelectorAll<HTMLButtonElement>(
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
              if (!creatingGroup && event.key === "Tab") close();
            }}
          >
            {creatingGroup ? (
              <form
                className="submenu-group-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createAndMove();
                }}
              >
                <label htmlFor="new-conversation-group">New group</label>
                <input
                  id="new-conversation-group"
                  aria-label="New group name"
                  value={groupName}
                  maxLength={80}
                  disabled={groupSaving}
                  onChange={(event) => setGroupName(event.target.value)}
                />
                {groupError && <p role="alert">{groupError}</p>}
                <button
                  type="submit"
                  disabled={groupSaving || !groupName.trim()}
                >
                  Create and move
                </button>
                <button
                  type="button"
                  disabled={groupSaving}
                  onClick={() => {
                    setCreatingGroup(false);
                    focusSubmenu.current = true;
                  }}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <>
                {(groups || []).map((group) => (
                  <button
                    key={group.id}
                    role="menuitem"
                    onClick={() => {
                      close();
                      onMove?.(group.id);
                    }}
                  >
                    <span>{group.name}</span>
                    {groupID === group.id && <Check size={15} />}
                  </button>
                ))}
                {groupID && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      close();
                      onMove?.(null);
                    }}
                  >
                    Ungrouped
                  </button>
                )}
                {!!(groups?.length || groupID) && (
                  <div
                    className="conversation-menu-separator"
                    role="separator"
                  />
                )}
                <button
                  role="menuitem"
                  onClick={() => {
                    focusSubmenu.current = true;
                    setCreatingGroup(true);
                    setGroupError("");
                  }}
                >
                  New group…
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

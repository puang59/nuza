import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import Sidebar from "../src/components/Sidebar";

function renderSidebar(rootPath: string | null, populated = false) {
  const noop = () => {};
  const data = populated ? [{ name: "note.md", path: "/vault/note.md", isDirectory: false }] : [];
  return renderToStaticMarkup(
    <Sidebar
      data={data}
      searchTree={data}
      notes={[]}
      rootPath={rootPath}
      vaults={[]}
      onOpenFolder={noop}
      onLoadFolder={async () => {}}
      onCreateFile={noop}
      onCreateFolder={noop}
      onRename={noop}
      onDuplicate={noop}
      onDelete={noop}
      onMove={noop}
      onAttachFiles={noop}
      onSelectVault={() => true}
      onRenameVault={noop}
      onForgetVault={noop}
      onResizeStart={noop}
      onResizeReset={noop}
      isResizing={false}
    />
  );
}

describe("sidebar folder actions", () => {
  test("offers Open Folder when no folder is open", () => {
    const html = renderSidebar(null);
    expect(html).toContain("Open Folder");
    expect(html).not.toContain('title="New File"');
  });

  test("keeps the toolbar in an opened empty folder", () => {
    const html = renderSidebar("/vault");
    for (const title of ["Search Files", "New File", "New Folder", "Sort Order", "Collapse Folders"]) {
      expect(html).toContain(`title="${title}"`);
    }
    expect(html).not.toContain("Open Folder");
  });

  test("keeps creation actions with or without the last file", () => {
    for (const populated of [true, false]) {
      const html = renderSidebar("/vault", populated);
      expect(html).toContain('title="New File"');
      expect(html).toContain('title="New Folder"');
    }
  });
});

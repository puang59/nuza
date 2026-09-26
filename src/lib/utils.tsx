import { File, FileJson, FileText } from "lucide-react";

export function FileIcon({ name }: { name: string }) {
  const extension = name.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "json":
      return <FileJson className="h-4 w-4 text-yellow-400" />;

    case "md":
    case "txt":
      return <FileText className="h-4 w-4 text-zinc-500" />;

    default:
      return <File className="h-4 w-4 text-zinc-500" />;
  }
}

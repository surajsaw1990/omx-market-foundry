import { ConsoleShell } from "@/components/shell";

export default function ConsoleLayout({ children }: LayoutProps<"/">) {
  return <ConsoleShell>{children}</ConsoleShell>;
}

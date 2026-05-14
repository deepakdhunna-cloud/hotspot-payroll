import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { fmtWeekRange } from "@/lib/format";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Upload,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  FileImage,
  FileText,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

function startOfWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

type ParsedRow = {
  extractedName: string;
  scheduledHours: number;
  matchedEmployeeId: number | null;
  matchedFullName: string | null;
  matchedStore: string | null;
};

export default function ScheduleImport() {
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [overrides, setOverrides] = useState<Record<number, number | null>>({});
  const [hourOverrides, setHourOverrides] = useState<Record<number, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scopeQ = trpc.meta.myScope.useQuery();
  const employeesQ = trpc.employees.list.useQuery({
    store: storeFilter === "all" ? undefined : (storeFilter as any),
  });

  const stores = scopeQ.data?.stores ?? [];
  const employeesList = employeesQ.data ?? [];

  const parseM = trpc.schedule.parseUpload.useMutation({
    onSuccess: (data) => {
      setRows(data.rows);
      const initialOverrides: Record<number, number | null> = {};
      const initialHours: Record<number, string> = {};
      data.rows.forEach((r, i) => {
        initialOverrides[i] = r.matchedEmployeeId;
        initialHours[i] = String(r.scheduledHours);
      });
      setOverrides(initialOverrides);
      setHourOverrides(initialHours);
      const matched = data.rows.filter((r) => r.matchedEmployeeId).length;
      toast.success(
        `Extracted ${data.totalExtracted} names — ${matched} auto-matched.`,
      );
    },
    onError: (e) => toast.error(e.message),
  });

  const utils = trpc.useUtils();
  const saveScheduleM = trpc.payroll.saveSchedule.useMutation({
    onSuccess: ({ saved }) => {
      toast.success(`Saved schedules for ${saved} employee${saved === 1 ? "" : "s"}.`);
      utils.payroll.week.invalidate();
      utils.dashboard.summary.invalidate();
      setRows(null);
      setFile(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const shiftWeek = (delta: number) => {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + delta * 7);
    setWeekStart(d);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  };

  const startParse = async () => {
    if (!file) return;
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/jpg", "application/pdf"];
    if (!allowed.includes(file.type)) {
      toast.error("Upload a PDF, PNG, JPG or WEBP image.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("File too large (max 8MB).");
      return;
    }
    const buf = await file.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(buf).reduce((acc, b) => acc + String.fromCharCode(b), ""),
    );
    parseM.mutate({
      fileBase64: base64,
      mimeType: file.type,
      filename: file.name,
      weekStart,
      store: storeFilter === "all" ? undefined : (storeFilter as any),
    });
  };

  const commit = () => {
    if (!rows) return;
    const entries = rows
      .map((r, i) => {
        const empId = overrides[i];
        const hrsRaw = hourOverrides[i] ?? String(r.scheduledHours);
        const hrs = Number(hrsRaw);
        if (!empId || isNaN(hrs) || hrs < 0) return null;
        return { employeeId: empId, scheduledHours: hrs };
      })
      .filter(Boolean) as { employeeId: number; scheduledHours: number }[];
    if (entries.length === 0) {
      toast.error("Nothing to import — match at least one employee.");
      return;
    }
    saveScheduleM.mutate({ weekStart, entries });
  };

  const matchedCount = useMemo(() => {
    if (!rows) return 0;
    return Object.values(overrides).filter(Boolean).length;
  }, [rows, overrides]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-primary font-semibold">
            AI Schedule Import
          </div>
          <h1 className="text-3xl font-bold tracking-tight mt-1 flex items-center gap-2">
            <Sparkles className="h-7 w-7 text-primary" /> Import Homebase schedule
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Drop a PDF, photo, or screenshot of your Homebase weekly schedule. AI extracts each
            employee and their scheduled hours automatically.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border bg-card/60 p-1">
            <Button variant="ghost" size="icon" onClick={() => shiftWeek(-1)} className="h-8 w-8">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2 px-2 text-sm font-medium">
              <CalendarDays className="h-4 w-4 text-primary" />
              {fmtWeekRange(weekStart)}
            </div>
            <Button variant="ghost" size="icon" onClick={() => shiftWeek(1)} className="h-8 w-8">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          {stores.length > 1 && (
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All stores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All my stores</SelectItem>
                {stores.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </header>

      <Card>
        <CardContent className="p-6">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-xl transition-colors cursor-pointer p-10 text-center ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/60 hover:bg-accent/40"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {!file ? (
              <div className="flex flex-col items-center gap-3">
                <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
                  <Upload className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Drop your Homebase schedule here</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    PDF, PNG, JPG or WEBP &nbsp;·&nbsp; up to 8MB
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-3">
                {file.type === "application/pdf" ? (
                  <FileText className="h-8 w-8 text-primary" />
                ) : (
                  <FileImage className="h-8 w-8 text-primary" />
                )}
                <div className="text-left">
                  <p className="font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(0)} KB
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    setRows(null);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          <div className="flex justify-end mt-4">
            <Button onClick={startParse} disabled={!file || parseM.isPending} className="shadow-lg">
              <Sparkles className="h-4 w-4 mr-2" />
              {parseM.isPending ? "Reading schedule…" : "Extract with AI"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {rows && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Review extracted schedule</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {rows.length} row{rows.length === 1 ? "" : "s"} extracted &middot;{" "}
                <span className="text-emerald-400">{matchedCount} matched</span> &middot;{" "}
                <span className="text-amber-400">{rows.length - matchedCount} need review</span>
              </p>
            </div>
            <Button onClick={commit} disabled={saveScheduleM.isPending}>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              {saveScheduleM.isPending ? "Saving…" : `Import ${matchedCount} schedules`}
            </Button>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Extracted name</TableHead>
                    <TableHead>Match to employee</TableHead>
                    <TableHead className="text-right w-[150px]">Scheduled hours</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => {
                    const matchedId = overrides[i];
                    return (
                      <TableRow key={i}>
                        <TableCell>
                          {matchedId ? (
                            <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Matched
                            </Badge>
                          ) : (
                            <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/30">
                              <AlertCircle className="h-3 w-3 mr-1" /> Review
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{row.extractedName}</TableCell>
                        <TableCell>
                          <Select
                            value={matchedId ? String(matchedId) : "skip"}
                            onValueChange={(v) =>
                              setOverrides((o) => ({
                                ...o,
                                [i]: v === "skip" ? null : Number(v),
                              }))
                            }
                          >
                            <SelectTrigger className="max-w-[300px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="skip">— Skip this row —</SelectItem>
                              {employeesList.map((e) => (
                                <SelectItem key={e.id} value={String(e.id)}>
                                  {e.fullName} · {e.storeLocation}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            step="0.25"
                            min="0"
                            value={hourOverrides[i] ?? String(row.scheduledHours)}
                            onChange={(e) =>
                              setHourOverrides((h) => ({ ...h, [i]: e.target.value }))
                            }
                            className="text-right h-9 tabular-nums"
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {!rows && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-2">How this works</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Export the weekly schedule from Homebase as PDF, or take a clear photo of it.</li>
              <li>Drop the file above and click <span className="text-foreground">Extract with AI</span>.</li>
              <li>Review the auto-matched employees and click Import.</li>
              <li>Scheduled hours now appear on the dashboard for over/under tracking.</li>
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

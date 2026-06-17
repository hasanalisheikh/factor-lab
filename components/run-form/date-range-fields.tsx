"use client";

import { useState } from "react";
import { CalendarIcon, ChevronsLeft, ChevronsRight } from "lucide-react";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { parseLocalDate } from "./run-form-schema";

import type { Dispatch, SetStateAction } from "react";
import type { DataCoverage } from "./run-form-schema";

function YearPickCalendar({
  startMonth,
  endMonth,
  selected,
  onSelect,
  disabled,
  autoFocus,
}: {
  startMonth?: Date;
  endMonth?: Date;
  selected?: Date;
  onSelect: (d: Date | undefined) => void;
  disabled?: (d: Date) => boolean;
  autoFocus?: boolean;
}) {
  const [yearPickMode, setYearPickMode] = useState(false);
  const [displayMonth, setDisplayMonth] = useState<Date>(selected ?? startMonth ?? new Date());

  const startYear = startMonth?.getFullYear() ?? 2015;
  const endYear = endMonth?.getFullYear() ?? new Date().getFullYear();

  const prevMonth = new Date(displayMonth.getFullYear(), displayMonth.getMonth() - 1);
  const nextMonth = new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1);
  const prevYear = new Date(displayMonth.getFullYear() - 1, displayMonth.getMonth());
  const nextYear = new Date(displayMonth.getFullYear() + 1, displayMonth.getMonth());
  const canPrevMonth =
    !startMonth || prevMonth >= new Date(startMonth.getFullYear(), startMonth.getMonth());
  const canNextMonth =
    !endMonth || nextMonth <= new Date(endMonth.getFullYear(), endMonth.getMonth());
  const canPrevYear =
    !startMonth || prevYear >= new Date(startMonth.getFullYear(), startMonth.getMonth());
  const canNextYear =
    !endMonth || nextYear <= new Date(endMonth.getFullYear(), endMonth.getMonth());

  return (
    <div className="p-3">
      <div className="mb-2 flex h-8 items-center justify-between">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => canPrevYear && setDisplayMonth(prevYear)}
            disabled={!canPrevYear}
            className="hover:bg-accent text-muted-foreground hover:text-foreground rounded-md p-1 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Previous year"
          >
            <ChevronsLeft className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => canPrevMonth && setDisplayMonth(prevMonth)}
            disabled={!canPrevMonth}
            className="hover:bg-accent text-muted-foreground hover:text-foreground rounded-md p-1 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Previous month"
          >
            <ChevronsLeft className="-ml-2 size-3" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => setYearPickMode((v) => !v)}
          className="hover:bg-accent rounded px-2 py-0.5 text-sm font-medium transition-colors"
          title="Pick a year"
        >
          {format(displayMonth, yearPickMode ? "yyyy" : "MMMM yyyy")}
        </button>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => canNextMonth && setDisplayMonth(nextMonth)}
            disabled={!canNextMonth}
            className="hover:bg-accent text-muted-foreground hover:text-foreground rounded-md p-1 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Next month"
          >
            <ChevronsRight className="-mr-2 size-3" />
          </button>
          <button
            type="button"
            onClick={() => canNextYear && setDisplayMonth(nextYear)}
            disabled={!canNextYear}
            className="hover:bg-accent text-muted-foreground hover:text-foreground rounded-md p-1 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Next year"
          >
            <ChevronsRight className="size-3.5" />
          </button>
        </div>
      </div>

      {yearPickMode ? (
        <div className="grid w-[220px] grid-cols-4 gap-1">
          {Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i).map((year) => (
            <button
              key={year}
              type="button"
              onClick={() => {
                setDisplayMonth(new Date(year, displayMonth.getMonth()));
                setYearPickMode(false);
              }}
              className={cn(
                "rounded-md py-1.5 text-sm transition-colors",
                year === displayMonth.getFullYear()
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              )}
            >
              {year}
            </button>
          ))}
        </div>
      ) : (
        <Calendar
          mode="single"
          showOutsideDays={false}
          hideNavigation
          captionLayout="label"
          startMonth={startMonth}
          endMonth={endMonth}
          month={displayMonth}
          onMonthChange={setDisplayMonth}
          selected={selected}
          onSelect={onSelect}
          disabled={disabled}
          autoFocus={autoFocus}
          className="p-0"
        />
      )}
    </div>
  );
}

type DateRangeFieldsProps = {
  coverageMin: Date | null;
  dataCoverage?: DataCoverage | null;
  dataCurrencyStr: string | null;
  endDate?: Date;
  endDateStr: string | null;
  endOpen: boolean;
  maxEndDateStr: string;
  minStartDateStr: string | null;
  setDateAdjustmentMessage: Dispatch<SetStateAction<string | null>>;
  setEndDate: Dispatch<SetStateAction<Date | undefined>>;
  setEndOpen: Dispatch<SetStateAction<boolean>>;
  setStartDate: Dispatch<SetStateAction<Date | undefined>>;
  setStartOpen: Dispatch<SetStateAction<boolean>>;
  startDate?: Date;
  startDateStr: string | null;
  startOpen: boolean;
};

export function DateRangeFields({
  coverageMin,
  dataCoverage,
  dataCurrencyStr,
  endDate,
  endDateStr,
  endOpen,
  maxEndDateStr,
  minStartDateStr,
  setDateAdjustmentMessage,
  setEndDate,
  setEndOpen,
  setStartDate,
  setStartOpen,
  startDate,
  startDateStr,
  startOpen,
}: DateRangeFieldsProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <Label className="text-muted-foreground text-[12px] font-medium">Date range</Label>
        <span className="text-muted-foreground text-[11px]">Min 2 years · 3+ recommended</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Popover open={startOpen} onOpenChange={setStartOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="bg-secondary/40 border-border h-8 w-full justify-start text-[13px] font-normal"
              >
                <CalendarIcon className="mr-2 size-3.5 opacity-60" />
                {startDate ? format(startDate, "MMM d, yyyy") : "Start date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <YearPickCalendar
                startMonth={coverageMin ?? new Date(2015, 0)}
                endMonth={maxEndDateStr ? parseLocalDate(maxEndDateStr) : new Date()}
                selected={startDate}
                onSelect={(d) => {
                  if (!d) return;
                  const selectedStr = format(d, "yyyy-MM-dd");
                  if (minStartDateStr && selectedStr < minStartDateStr) {
                    setStartDate(parseLocalDate(minStartDateStr));
                    setDateAdjustmentMessage(`Start date snapped to ${minStartDateStr}.`);
                    setStartOpen(false);
                    return;
                  }
                  if (maxEndDateStr && selectedStr > maxEndDateStr) return;
                  setStartDate(d);
                  setStartOpen(false);
                }}
                disabled={(d) => {
                  const value = format(d, "yyyy-MM-dd");
                  if (minStartDateStr && value < minStartDateStr) return true;
                  if (maxEndDateStr && value > maxEndDateStr) return true;
                  if (endDateStr && value > endDateStr) return true;
                  return false;
                }}
                autoFocus
              />
            </PopoverContent>
          </Popover>
        </div>
        <div>
          <Popover open={endOpen} onOpenChange={setEndOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="bg-secondary/40 border-border h-8 w-full justify-start text-[13px] font-normal"
              >
                <CalendarIcon className="mr-2 size-3.5 opacity-60" />
                {endDate ? format(endDate, "MMM d, yyyy") : "End date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <YearPickCalendar
                startMonth={coverageMin ?? new Date(2015, 0)}
                endMonth={maxEndDateStr ? parseLocalDate(maxEndDateStr) : new Date()}
                selected={endDate}
                onSelect={(d) => {
                  if (!d) return;
                  const selectedStr = format(d, "yyyy-MM-dd");
                  if (startDateStr && selectedStr < startDateStr) {
                    setEndDate(parseLocalDate(startDateStr));
                    setDateAdjustmentMessage(`End date snapped to ${startDateStr}.`);
                    setEndOpen(false);
                    return;
                  }
                  if (maxEndDateStr && selectedStr > maxEndDateStr) {
                    setEndDate(parseLocalDate(maxEndDateStr));
                    setDateAdjustmentMessage(`End date snapped to ${maxEndDateStr}.`);
                    setEndOpen(false);
                    return;
                  }
                  setEndDate(d);
                  setEndOpen(false);
                }}
                disabled={(d) => {
                  const value = format(d, "yyyy-MM-dd");
                  if (startDateStr && value < startDateStr) return true;
                  if (maxEndDateStr && value > maxEndDateStr) return true;
                  return false;
                }}
                autoFocus
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <div className="space-y-0.5">
        {dataCurrencyStr && (
          <p className="text-muted-foreground text-[11px]">
            Data current through{" "}
            <span className="text-foreground font-mono font-medium">{dataCurrencyStr}</span>
            {dataCurrencyStr < maxEndDateStr ? (
              <span className="text-amber-400"> (missing data will be auto-ingested)</span>
            ) : (
              <span className="text-emerald-400"> (Backtest-ready)</span>
            )}
            .
          </p>
        )}
        {dataCoverage?.minDateStr && (
          <p className="text-muted-foreground text-[11px]">
            Earliest visible history: {dataCoverage.minDateStr}
          </p>
        )}
      </div>
    </div>
  );
}

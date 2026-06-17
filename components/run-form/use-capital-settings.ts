"use client";

import { useState } from "react";

import { CAPITAL_DEFAULT, CAPITAL_MAX, CAPITAL_MIN } from "./constants";

import type { ChangeEvent } from "react";
import type { UserSettings } from "@/lib/supabase/types";

export function useCapitalSettings(defaults: UserSettings | null) {
  const [display, setDisplay] = useState(
    (defaults?.default_initial_capital ?? CAPITAL_DEFAULT).toLocaleString("en-US")
  );
  const [value, setValue] = useState(defaults?.default_initial_capital ?? CAPITAL_DEFAULT);

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    setDisplay(e.target.value);
  }

  function onBlur() {
    const cleaned = display.replace(/,/g, "").trim();
    const n = Math.round(Number(cleaned));
    if (!cleaned || !Number.isFinite(n) || isNaN(n)) {
      setValue(CAPITAL_DEFAULT);
      setDisplay(CAPITAL_DEFAULT.toLocaleString("en-US"));
      return;
    }
    const clamped = Math.max(CAPITAL_MIN, Math.min(CAPITAL_MAX, n));
    setValue(clamped);
    setDisplay(clamped.toLocaleString("en-US"));
  }

  function setPreset(nextValue: number) {
    setValue(nextValue);
    setDisplay(nextValue.toLocaleString("en-US"));
  }

  return {
    controller: {
      display,
      onBlur,
      onChange,
      setPreset,
      value,
    },
    value,
  };
}

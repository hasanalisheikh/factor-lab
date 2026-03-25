"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowRight, PlaySquare, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";

export function TopbarSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function navigate(path: string) {
    setOpen(false);
    setQuery("");
    router.push(path);
  }

  function handleSearch() {
    if (!query.trim()) return;
    navigate(`/runs?q=${encodeURIComponent(query.trim())}`);
  }

  return (
    <>
      {/* Desktop: visible search bar */}
      <button
        onClick={() => setOpen(true)}
        className="border-border bg-secondary/40 text-muted-foreground hover:bg-secondary/60 hidden h-8 w-[220px] cursor-text items-center gap-2 rounded-md border px-3 text-[12px] transition-colors lg:flex"
        aria-label="Search (⌘K)"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 text-left">Search…</span>
      </button>

      {/* Mobile: icon only */}
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-foreground h-8 w-8 lg:hidden"
        aria-label="Search (⌘K)"
        onClick={() => setOpen(true)}
      >
        <Search className="h-[15px] w-[15px]" />
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setQuery("");
        }}
        title="Search"
        description="Search runs, jobs, and more"
        showCloseButton={false}
        className="max-w-lg"
      >
        <CommandInput
          placeholder="Search runs by name, strategy, universe…"
          value={query}
          onValueChange={setQuery}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSearch();
            }
          }}
        />
        <CommandList>
          {query.trim() ? (
            <>
              <CommandEmpty>No suggestions — press Enter to search.</CommandEmpty>
              <CommandGroup heading="Runs">
                <CommandItem onSelect={handleSearch}>
                  <Search className="text-muted-foreground" />
                  <span>
                    Search runs for{" "}
                    <span className="text-foreground font-medium">
                      &ldquo;{query.trim()}&rdquo;
                    </span>
                  </span>
                  <CommandShortcut>↵</CommandShortcut>
                </CommandItem>
                <CommandItem onSelect={handleSearch}>
                  <ArrowRight className="text-muted-foreground" />
                  View all results
                  <CommandShortcut>↵</CommandShortcut>
                </CommandItem>
              </CommandGroup>
            </>
          ) : (
            <CommandGroup heading="Quick links">
              <CommandItem onSelect={() => navigate("/runs")}>
                <PlaySquare className="text-muted-foreground" />
                All Runs
              </CommandItem>
              <CommandItem onSelect={() => navigate("/runs/new")}>
                <ArrowRight className="text-muted-foreground" />
                New Run
              </CommandItem>
              <CommandItem onSelect={() => navigate("/jobs")}>
                <Briefcase className="text-muted-foreground" />
                Jobs
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>
        <div className="flex items-center justify-between border-t px-3 py-2">
          <span className="text-muted-foreground text-[11px]">
            <kbd className="bg-muted mr-0.5 rounded px-1 py-0.5 font-mono text-[10px]">↵</kbd>
            search &nbsp;·&nbsp;
            <kbd className="bg-muted mr-0.5 rounded px-1 py-0.5 font-mono text-[10px]">↑↓</kbd>
            navigate &nbsp;·&nbsp;
            <kbd className="bg-muted mr-0.5 rounded px-1 py-0.5 font-mono text-[10px]">esc</kbd>
            close
          </span>
        </div>
      </CommandDialog>
    </>
  );
}

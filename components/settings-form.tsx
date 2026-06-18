"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { AccountTab } from "./settings-form/account-tab";
import { BacktestTab } from "./settings-form/backtest-tab";
import type { SettingsFormProps, UserInfo } from "./settings-form/types";

export type { UserInfo };

export function SettingsForm({ defaults, user, defaultTab }: SettingsFormProps) {
  const initialTab = defaultTab === "account" ? "account" : "backtest";
  return (
    <Tabs defaultValue={initialTab} className="gap-4">
      <TabsList className="h-8">
        <TabsTrigger value="backtest" className="h-6 px-3 text-[12px]">
          Backtest
        </TabsTrigger>
        <TabsTrigger value="account" className="h-6 px-3 text-[12px]">
          Account
        </TabsTrigger>
      </TabsList>

      <TabsContent value="backtest">
        <BacktestTab defaults={defaults} />
      </TabsContent>

      <TabsContent value="account">
        <AccountTab user={user} />
      </TabsContent>
    </Tabs>
  );
}

import type { UserSettings } from "@/lib/supabase/types";

export type UserInfo = {
  id: string;
  email: string;
  is_guest: boolean;
};

export type SettingsFormProps = {
  defaults: UserSettings | null;
  user: UserInfo;
  defaultTab?: string;
};

import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[^a-zA-Z0-9]/, "Password must contain at least one special character");

export const emailPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: passwordSchema,
});

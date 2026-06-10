import { z } from "zod";

export const USERNAME_PATTERN = "^[a-zA-Z0-9._-]{3,30}$";
export const USERNAME_REGEX = /^[a-zA-Z0-9._-]{3,30}$/;
export const USERNAME_MESSAGE = "Usuario inválido";

export const usernameSchema = z.string().regex(USERNAME_REGEX, USERNAME_MESSAGE);

import { env } from "../../config/env.js";
import { signOtpChallenge, signToken } from "./token.js";
import type { User } from "./auth.types.js";
import type { OtpRepository } from "./otp.repository.js";

export async function beginOtpLogin(
  user: User,
  repository: OtpRepository,
  challengeExpiresSeconds = env.OTP_CHALLENGE_EXPIRES_SECONDS,
) {
  const state = await repository.getState(user.id);
  if (state?.active) {
    return {
      otpRequired: true as const,
      challengeToken: signOtpChallenge(user, challengeExpiresSeconds),
    };
  }
  return { otpRequired: false as const, token: signToken(user) };
}

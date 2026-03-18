import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { prisma } from "./prisma.js";

function getGoogleProfileData(profile: any) {
  const email = profile.emails?.[0]?.value;
  const givenName = profile.name?.givenName?.trim() || null;
  const familyName = profile.name?.familyName?.trim() || null;
  const fullName = profile.displayName?.trim() || [givenName, familyName].filter(Boolean).join(" ") || email;
  return { email, givenName, familyName, fullName };
}

function buildGoogleUpdateData(user: any, profileId: string, givenName: string | null, familyName: string | null, fullName: string | null | undefined) {
  const updateData: Record<string, unknown> = {};
  if (!user.googleId) updateData.googleId = profileId;
  if (!user.firstName && givenName) updateData.firstName = givenName;
  if (!user.lastName && familyName) updateData.lastName = familyName;
  if (!user.name && fullName) updateData.name = fullName;
  return updateData;
}

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CALLBACK_URL) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const { email, givenName, familyName, fullName } = getGoogleProfileData(profile);
          if (!email) return done(null, false);

          let user = await prisma.user.findFirst({
            where: { OR: [{ googleId: profile.id }, { email }] },
          });

          if (!user) {
            user = await prisma.user.create({
              data: {
                email,
                name: fullName,
                firstName: givenName,
                lastName: familyName,
                googleId: profile.id,
                isApproved: false,
                approvedAt: null,
                isActive: true,
              },
            });
          } else {
            const updateData = buildGoogleUpdateData(user, profile.id, givenName, familyName, fullName);
            if (Object.keys(updateData).length > 0) {
              user = await prisma.user.update({
                where: { id: user.id },
                data: updateData,
              });
            }
          }

          done(null, user);
        } catch (e) {
          done(e instanceof Error ? e : new Error(String(e)), false);
        }
      }
    )
  );
}

export default passport;

-- On-screen guide (training): on for everyone; each person can turn it off in Mi perfil.
ALTER TABLE "User" ADD COLUMN "guideOn" BOOLEAN NOT NULL DEFAULT true;

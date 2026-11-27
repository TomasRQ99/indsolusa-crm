-- A piece description already translated for an email, kept so the AI is asked once per text and language.
CREATE TABLE "PieceText" (
    "key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PieceText_pkey" PRIMARY KEY ("key")
);

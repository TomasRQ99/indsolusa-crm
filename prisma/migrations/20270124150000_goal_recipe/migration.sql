-- Recetario mensual: the person's own monthly sales recipe.
CREATE TABLE "GoalRecipe" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "salesGoal" DECIMAL(14,2) NOT NULL,
    "avgSale" DECIMAL(14,2) NOT NULL,
    "quotesPerClose" INTEGER NOT NULL DEFAULT 2,
    "meetingsPerQuote" INTEGER NOT NULL DEFAULT 2,
    "pitchesPerMeeting" INTEGER NOT NULL DEFAULT 3,
    "activitiesPerPitch" INTEGER NOT NULL DEFAULT 3,
    "setByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoalRecipe_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoalRecipe_userId_period_key" ON "GoalRecipe"("userId", "period");

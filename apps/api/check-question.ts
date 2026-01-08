import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const question = await prisma.question.findUnique({
    where: { id: 6830 },
    select: {
      id: true,
      type: true,
      scoring: true,
    },
  });

  if (question?.scoring) {
    console.log("Scoring configuration:", question.scoring);
  }
}

main()
  .catch(console.error)
  .finally(() => {
    void prisma.$disconnect();
  });

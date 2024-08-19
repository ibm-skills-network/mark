import Title from "@/components/Title";
import type { FC } from "react";

interface PageTitleProps {
  title: string;
  description?: string;
}

const PageTitle: FC<PageTitleProps> = ({ title, description }) => (
  <section className="flex flex-col gap-y-1.5 text-gray-900">
    <Title level={1}>{title}</Title>
    {description && (
      <p className="w-full text-base font-[450] text-gray-600">{description}</p>
    )}
  </section>
);

export default PageTitle;

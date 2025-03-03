import animationData from "@/animations/LoadSN.json";
import LoadingPage from "@/app/loading";

export default function Loading() {
  return <LoadingPage animationData={animationData} />;
}

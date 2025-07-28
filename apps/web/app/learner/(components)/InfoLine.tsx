interface Props {
  text: string;
}

function InfoLine(props: Props) {
  const { text } = props;

  return <p className="mb-4 text-gray-700">{text}</p>;
}

export default InfoLine;

/** A row of mutually exclusive choices, as the theme picker draws them. */
export default function Segmented<T extends string>({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex rounded-md border border-zinc-700 bg-zinc-800 p-0.5"
    >
      {choices.map((choice) => (
        <button
          key={choice.id}
          type="button"
          role="radio"
          aria-checked={value === choice.id}
          onClick={() => onChange(choice.id)}
          className={`cursor-pointer rounded px-2.5 py-0.5 text-xs transition-colors ${
            value === choice.id ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white"
          }`}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

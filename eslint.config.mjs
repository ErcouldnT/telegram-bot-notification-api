import antfu from "@antfu/eslint-config";

export default antfu({
  stylistic: {
    semi: "always",
    quotes: "double",
  },
  rules: {
    "@stylistic/member-delimiter-style": [
      "error",
      {
        multiline: { delimiter: "semi", requireLast: true },
        singleline: { delimiter: "semi", requireLast: false },
      },
    ],
  },
});

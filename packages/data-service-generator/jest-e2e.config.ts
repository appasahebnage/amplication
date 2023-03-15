export default {
  preset: "../../jest.preset.js",
  displayName: "data-service-generator",
  globals: {
    "ts-jest": {
      tsconfig: "<rootDir>/tsconfig.spec.json",
    },
  },
  moduleFileExtensions: ["js", "json", "ts"],
  testEnvironment: "node",
  testMatch: ["**/?(*.)+(e2e.spec).[jt]s?(x)"],
  testTimeout: 100000000,
  maxConcurrency: 2,
};

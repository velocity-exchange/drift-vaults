module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	testMatch: [
		// '**/tests/**/velocityVaults.ts'
		// '**/tests/**/*.test.ts'
		'**/tests/**/*.ts'
		// '**/tests/**/feeUpdate.test.ts'
	],
	testPathIgnorePatterns: [
		'tests/common/',
		'tests/fixtures/',
		//'tests/velocityVaults.ts'
	],
	testTimeout: 1000000,  // This matches your current 1000000ms timeout
	transform: {
		'^.+\\.ts$': 'ts-jest',
	},
	setupFilesAfterEnv: ['jest-expect-message']
}

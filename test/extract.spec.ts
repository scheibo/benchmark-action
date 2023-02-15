import * as path from 'path';
import { strict as A } from 'assert';
import { Config, ToolType } from '../src/config';
import { BenchmarkResult, extractResult } from '../src/extract';

const dummyWebhookPayload = {
    head_commit: {
        author: null,
        committer: null,
        id: '123456789abcdef',
        message: 'this is dummy',
        timestamp: 'dummy timestamp',
        url: 'https://github.com/dummy/repo',
    },
} as { [key: string]: any };
let dummyCommitData = {};
class DummyGitHub {
    repos = {
        getCommit: () => {
            return {
                status: 200,
                data: dummyCommitData,
            };
        },
    };
}
const dummyGitHubContext = {
    payload: dummyWebhookPayload,
    repo: {
        owner: 'dummy',
        repo: 'repo',
    },
    ref: 'abcd1234',
};

jest.mock('@actions/github', () => ({
    get context() {
        return dummyGitHubContext;
    },
    get GitHub() {
        return DummyGitHub;
    },
}));

describe('extractResult()', function () {
    afterAll(function () {
        jest.unmock('@actions/github');
    });

    afterEach(function () {
        dummyGitHubContext.payload = dummyWebhookPayload;
    });

    const normalCases: Array<{
        tool: ToolType;
        expected: BenchmarkResult[];
        file?: string;
    }> = [
        {
            tool: 'customBiggerIsBetter',
            expected: [
                {
                    name: 'My Custom Bigger Is Better Benchmark - Throughput',
                    unit: 'req/s',
                    value: 70,
                    range: undefined,
                    extra: undefined,
                },
                {
                    name: 'My Custom Bigger Is Better Benchmark - Free Memory',
                    unit: 'Megabytes',
                    value: 150,
                    range: '3',
                    extra: 'Optional Value #1: 25\nHelpful Num #2: 100\nAnything Else!',
                },
            ],
        },
        {
            tool: 'customSmallerIsBetter',
            expected: [
                {
                    name: 'My Custom Smaller Is Better Benchmark - CPU Load',
                    unit: 'Percent',
                    value: 50,
                    range: '5%',
                    extra: 'My Optional Information for the tooltip',
                },
                {
                    name: 'My Custom Smaller Is Better Benchmark - Memory Used',
                    unit: 'Megabytes',
                    value: 100,
                    range: undefined,
                    extra: undefined,
                },
            ],
        },
    ];

    for (const test of normalCases) {
        it(`extracts benchmark output from ${test.tool}${test.file ? ` - ${test.file}` : ''}`, async function () {
            const file = test.file ?? `${test.tool}_output.txt`;
            const outputFilePath = path.join(__dirname, 'data', 'extract', file);
            const config = {
                tool: test.tool,
                outputFilePath,
            } as Config;
            const bench = await extractResult(config);

            A.equal(bench.commit, dummyWebhookPayload.head_commit);
            A.ok(bench.date <= Date.now(), bench.date.toString());
            A.equal(bench.tool, test.tool);
            A.deepEqual(test.expected, bench.benches);
        });
    }

    it('raises an error on unexpected tool', async function () {
        const config = {
            tool: 'foo' as any,
            outputFilePath: path.join(__dirname, 'data', 'extract', 'customBiggerIsBetter_output.txt'),
        } as Config;
        await A.rejects(extractResult(config), /^Error: FATAL: Unexpected tool: 'foo'$/);
    });

    it('raises an error when output file is not readable', async function () {
        const config = {
            tool: 'customBiggerIsBetter',
            outputFilePath: 'path/does/not/exist.txt',
        } as Config;
        await A.rejects(extractResult(config));
    });

    it('raises an error when no output found', async function () {
        const config = {
            tool: 'customBiggerIsBetter',
            outputFilePath: path.join(__dirname, 'data', 'extract', 'noresults.txt'),
        } as Config;
        await A.rejects(extractResult(config), /^Error: No benchmark result was found in /);
    });

    const toolSpecificErrorCases: Array<{
        it: string;
        tool: ToolType;
        file: string;
        expected: RegExp;
    }> = [
        ...(['customBiggerIsBetter', 'customSmallerIsBetter'] as const).map((tool) => ({
            it: `raises an error when output file is not in JSON with tool '${tool}'`,
            tool,
            file: 'notjson.txt',
            expected: /must be JSON file/,
        })),
    ];

    for (const t of toolSpecificErrorCases) {
        it(t.it, async function () {
            // Note: go_output.txt is not in JSON format!
            const outputFilePath = path.join(__dirname, 'data', 'extract', t.file);
            const config = { tool: t.tool, outputFilePath } as Config;
            await A.rejects(extractResult(config), t.expected);
        });
    }

    it('collects the commit information from pull_request payload as fallback', async function () {
        dummyGitHubContext.payload = {
            pull_request: {
                title: 'this is title',
                html_url: 'https://github.com/dummy/repo/pull/1',
                head: {
                    sha: 'abcdef0123456789',
                    user: {
                        login: 'user',
                    },
                    repo: {
                        updated_at: 'repo updated at timestamp',
                    },
                },
            },
        };
        const outputFilePath = path.join(__dirname, 'data', 'extract', 'customBiggerIsBetter_output.txt');
        const config = {
            tool: 'customBiggerIsBetter',
            outputFilePath,
        } as Config;
        const { commit } = await extractResult(config);
        const expectedUser = {
            name: 'user',
            username: 'user',
        };
        A.deepEqual(commit.author, expectedUser);
        A.deepEqual(commit.committer, expectedUser);
        A.equal(commit.id, 'abcdef0123456789');
        A.equal(commit.message, 'this is title');
        A.equal(commit.timestamp, 'repo updated at timestamp');
        A.equal(commit.url, 'https://github.com/dummy/repo/pull/1/commits/abcdef0123456789');
    });

    it('collects the commit information from current head via REST API as fallback when githubToken is provided', async function () {
        dummyGitHubContext.payload = {};
        dummyCommitData = {
            author: {
                login: 'testAuthorLogin',
            },
            committer: {
                login: 'testCommitterLogin',
            },
            commit: {
                author: {
                    name: 'test author',
                    date: 'author updated at timestamp',
                    email: 'author@testdummy.com',
                },
                committer: {
                    name: 'test committer',
                    // We use the `author.date` instead.
                    // date: 'committer updated at timestamp',
                    email: 'committer@testdummy.com',
                },
                message: 'test message',
            },
            sha: 'abcd1234',
            html_url: 'https://github.com/dymmy/repo/commit/abcd1234',
        };
        const outputFilePath = path.join(__dirname, 'data', 'extract', 'customBiggerIsBetter_output.txt');
        const config = {
            tool: 'customBiggerIsBetter',
            outputFilePath,
            githubToken: 'abcd1234',
        } as Config;

        const { commit } = await extractResult(config);

        const expectedCommit = {
            id: 'abcd1234',
            message: 'test message',
            timestamp: 'author updated at timestamp',
            url: 'https://github.com/dymmy/repo/commit/abcd1234',
            author: {
                name: 'test author',
                username: 'testAuthorLogin',
                email: 'author@testdummy.com',
            },
            committer: {
                name: 'test committer',
                username: 'testCommitterLogin',
                email: 'committer@testdummy.com',
            },
        };
        A.deepEqual(commit, expectedCommit);
    });

    it('raises an error when commit information is not found in webhook payload and no githubToken is provided', async function () {
        dummyGitHubContext.payload = {};
        const outputFilePath = path.join(__dirname, 'data', 'extract', 'customBiggerIsBetter_output.txt');
        const config = {
            tool: 'customBiggerIsBetter',
            outputFilePath,
        } as Config;
        await A.rejects(extractResult(config), /^Error: No commit information is found in payload/);
    });
});

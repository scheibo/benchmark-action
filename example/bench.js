const fib = (n) => (n <= 1 ? 1 : fib(n - 2) + fib(n - 1));

const benchmark = (n) => {
    let duration = 0n;
    let total = 0;
    for (let i = 0; i < 100; i++) {
        const begin = process.hrtime.bigint();
        total += fib(n);
        duration += process.hrtime.bigint() - begin;
    }
    return {
        name: `fib(${n})`,
        range: '±0.00%',
        unit: 'ns/call',
        value: Number(duration / 100n),
        extra: total.toString(),
    };
};

console.log(JSON.stringify([benchmark(10), benchmark(20)], null, 2));

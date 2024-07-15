self.addEventListener('message', (event) => {
    const data = event.data;
    if (data.message === 'initialize') {

    } else if (data.message === 'simulate') {

    }
    // self.postMessage({
    //     name: 'bob',
    //     age: 18,
    // });
});
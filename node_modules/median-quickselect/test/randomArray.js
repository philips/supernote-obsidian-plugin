module.exports = len => {
    const data = [];
    for (let i = 0; i < len; i++) {
        data.push(Math.random());
    }
    return data;
};
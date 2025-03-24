import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
      stderrLevels: ['error', 'warn', 'info', 'verbose', 'debug', 'silly'] // 所有级别都输出到 stderr
    })
  ],
});

export default logger;
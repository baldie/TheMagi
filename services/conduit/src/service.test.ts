import axios, { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { ensureMagiConduitIsRunning } from './index';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Conduit Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should detect when conduit is already running', async () => {
    const mockResponse: AxiosResponse = {
      data: 'OK',
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {} as InternalAxiosRequestConfig,
    };
    mockedAxios.get.mockResolvedValue(mockResponse);
    
    const consoleSpy = jest.spyOn(console, 'info').mockImplementation();
    
    await ensureMagiConduitIsRunning();
    
    expect(mockedAxios.get).toHaveBeenCalledWith('http://127.0.0.1:11434');
    expect(consoleSpy).toHaveBeenCalledWith('Magi Conduit service is already running.');
    
    consoleSpy.mockRestore();
  });
});